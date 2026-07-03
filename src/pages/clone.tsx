import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import Head from "next/head";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Layers,
  Palette,
  Type,
  Tag,
  Users,
  Check,
  AlertCircle,
  Loader2,
  Globe,
  Monitor,
  Tablet,
  Smartphone,
} from "lucide-react";

// DS accent — used only as a signal color (spinner, selected checkbox/toggle)
const ACCENT = "#0099FF";

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORT_WIDTH: Record<Viewport, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 390,
};

interface MarketplaceData {
  found: boolean;
  name?: string;
  description?: string;
  categories?: string[];
  keyFeatures?: string[];
  targetAudience?: string[];
}

interface SiteAnalysis {
  url: string;
  title: string;
  description: string;
  isFramer: boolean;
  pages: string[];
  colors: string[];
  fonts: string[];
  marketplace: MarketplaceData | null;
}

const PROGRESS_STAGES = [
  { label: "Connecting…", max: 9 },
  { label: "Fetching pages…", max: 36 },
  { label: "Downloading assets…", max: 74 },
  { label: "Packaging ZIP…", max: 91 },
];

function stageLabel(pct: number): string {
  for (const s of PROGRESS_STAGES) if (pct < s.max) return s.label;
  return "Packaging ZIP…";
}

function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-md bg-white/10 animate-pulse ${className ?? ""}`}
      style={style}
    />
  );
}

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon?: React.ElementType;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      {Icon && <Icon className="h-3.5 w-3.5 text-[#999999]" />}
      <span className="text-[10px] uppercase tracking-[0.16em] text-[#999999] font-semibold">
        {label}
      </span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] text-white/70 font-medium">
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer select-none">
      <span className="text-xs text-white/70">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0"
        style={{ background: checked ? ACCENT : "rgba(255,255,255,0.2)" }}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform"
          style={{
            transform: checked ? "translateX(18px)" : "translateX(2px)",
          }}
        />
      </button>
    </label>
  );
}

export default function ClonePage() {
  const router = useRouter();
  const { url } = router.query as { url?: string };

  const [analysis, setAnalysis] = useState<SiteAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [removeWatermark, setRemoveWatermark] = useState(true);
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!url) return;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        if (!data.isFramer)
          throw new Error(
            "Not a Framer website. Only Framer sites are supported.",
          );
        setAnalysis(data);
        setSelectedPages(new Set(data.pages as string[]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to analyze site");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [url]);

  const startProgress = () => {
    setProgress(0);
    setProgressLabel(PROGRESS_STAGES[0].label);
    let pct = 0;
    progressRef.current = setInterval(() => {
      const increment = pct < 20 ? 3 : pct < 50 ? 1.5 : pct < 80 ? 0.8 : 0.3;
      pct = Math.min(pct + increment + Math.random() * increment * 0.5, 91);
      setProgress(pct);
      setProgressLabel(stageLabel(pct));
    }, 600);
  };

  const finishProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
    setProgressLabel("Done!");
  };

  const stopProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(0);
    setProgressLabel("");
  };

  const handleClone = () => {
    if (!url || cloning || !analysis) return;
    setCloning(true);
    setCloned(false);
    setError("");
    startProgress();

    // Stream the clone: long jobs survive (no held POST), progress is real,
    // and failures surface in the page instead of a missable alert.
    const es = new EventSource(
      `/api/clone-stream?url=${encodeURIComponent(url)}&removeWatermarks=${removeWatermark}`,
    );

    const fail = (message: string) => {
      es.close();
      stopProgress();
      setError(message);
      setCloning(false);
    };

    es.onmessage = (e) => {
      let data: {
        type?: string;
        message?: string;
        jobId?: string;
        filename?: string;
      };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data.type === "status" || data.type === "progress") {
        if (data.message) setProgressLabel(data.message);
      } else if (data.type === "error") {
        fail(data.message || "Clone failed");
      } else if (data.type === "ready" && data.jobId) {
        es.close();
        finishProgress();
        const name = (
          analysis.marketplace?.name ||
          analysis.title ||
          "framer-site"
        )
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        const a = document.createElement("a");
        a.href = `/api/clone-download?jobId=${encodeURIComponent(data.jobId)}&filename=${encodeURIComponent(`${name}.zip`)}`;
        a.click();
        setCloned(true);
        setCloning(false);
      }
    };

    es.onerror = () => {
      // Fires on connection loss; if the stream already finished this is a no-op
      if (es.readyState === EventSource.CLOSED) return;
      fail(
        "Connection lost while cloning. Check the server logs and try again.",
      );
    };
  };

  const togglePage = (page: string) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) {
        if (next.size > 1) next.delete(page);
      } else {
        next.add(page);
      }
      return next;
    });
  };

  const displayTitle =
    analysis?.marketplace?.name ||
    analysis?.title ||
    (url
      ? (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return url;
          }
        })()
      : "");

  const hostname = url
    ? (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })()
    : "";

  const iframeWidth = VIEWPORT_WIDTH[viewport];

  return (
    <>
      <Head>
        <title>
          {displayTitle ? `${displayTitle} · SiteForge` : "SiteForge"}
        </title>
      </Head>

      <div
        className="h-dvh flex flex-col overflow-hidden"
        style={{
          background: "var(--ds-canvas)",
          fontFamily: "var(--font-body)",
        }}
      >
        {/* ── Top bar ── */}
        <div
          className="flex items-center gap-3 px-4 h-12 shrink-0"
          style={{ borderBottom: "1px solid var(--ds-hairline-soft)" }}
        >
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: "var(--ds-ink-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--ds-ink-muted)")
            }
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>

          <div
            className="w-px h-4"
            style={{ background: "var(--ds-hairline)" }}
          />

          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span
              aria-hidden
              className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[9px] font-bold text-white"
              style={{
                background: "linear-gradient(135deg, #8B3DFF 0%, #E44BE0 100%)",
              }}
            >
              F
            </span>
            <span
              className="hidden text-sm text-white sm:block"
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                letterSpacing: "-0.4px",
              }}
            >
              SiteForge
            </span>
          </Link>

          <div
            className="w-px h-4 hidden sm:block"
            style={{ background: "var(--ds-hairline)" }}
          />

          {loading ? (
            <div className="h-3 w-40 rounded bg-white/[0.06] animate-pulse hidden sm:block" />
          ) : (
            <span className="text-white/25 text-xs truncate hidden sm:block max-w-[240px]">
              {url}
            </span>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* ── Preview area ── */}
          <div
            className="flex-1 flex flex-col overflow-hidden"
            style={{ background: "#0F0E0D" }}
          >
            {/* Browser chrome */}
            <div
              className="flex items-center gap-2 px-4 h-10 shrink-0"
              style={{
                background: "var(--ds-surface-1)",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="flex items-center gap-1.5">
                {(["#ef4444", "#f59e0b", "#22c55e"] as const).map((c) => (
                  <span
                    key={c}
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: c, opacity: 0.7 }}
                  />
                ))}
              </div>
              <div
                className="flex-1 flex items-center gap-2 rounded-md px-3 py-1 mx-2 max-w-sm"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <Globe
                  className="h-3 w-3 shrink-0"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                />
                <span
                  className="text-[11px] truncate"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  {hostname || "loading…"}
                </span>
              </div>

              {/* Viewport toggle */}
              <div
                className="ml-auto flex items-center rounded-lg overflow-hidden"
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {(
                  [
                    { key: "desktop", Icon: Monitor, label: "Desktop" },
                    { key: "tablet", Icon: Tablet, label: "Tablet" },
                    { key: "mobile", Icon: Smartphone, label: "Mobile" },
                  ] as const
                ).map(({ key, Icon, label }) => (
                  <button
                    key={key}
                    title={label}
                    onClick={() => setViewport(key)}
                    className="flex items-center justify-center h-7 w-8 transition-colors"
                    style={{
                      background:
                        viewport === key
                          ? "rgba(255,255,255,0.14)"
                          : "transparent",
                      color:
                        viewport === key ? "#ffffff" : "rgba(255,255,255,0.3)",
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            </div>

            {/* iframe or states */}
            <div className="flex-1 relative overflow-auto">
              {url && !error && (
                <div
                  className="h-full transition-all duration-300 relative"
                  style={{
                    width: iframeWidth ? `${iframeWidth}px` : "100%",
                    margin: iframeWidth ? "0 auto" : undefined,
                    minHeight: "100%",
                  }}
                >
                  <iframe
                    src={url}
                    className="w-full h-full border-0"
                    style={{ minHeight: "100%" }}
                    title="Site preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    onError={() => {}}
                  />
                  {/* Fallback note for sites that block embedding */}
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none"
                    style={{ opacity: 0 }}
                    aria-hidden
                  >
                    <span
                      className="text-xs"
                      style={{ color: "rgba(255,255,255,0.3)" }}
                    >
                      Preview not available. This site blocks embedding.
                    </span>
                  </div>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <AlertCircle
                    className="h-8 w-8"
                    style={{ color: "rgba(255,255,255,0.12)" }}
                  />
                  <p
                    className="text-sm text-center max-w-xs leading-relaxed"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  >
                    {error}
                  </p>
                  <Link
                    href="/"
                    className="text-xs rounded-full px-4 py-2 transition-colors"
                    style={{
                      color: "rgba(255,255,255,0.4)",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    Try another URL
                  </Link>
                </div>
              )}
              {loading && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Loader2
                    className="h-6 w-6 animate-spin"
                    style={{ color: ACCENT }}
                  />
                  <span
                    className="text-xs"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                  >
                    Analyzing site…
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Sidebar ── */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="w-[300px] shrink-0 flex flex-col"
            style={{
              background: "var(--ds-surface-1)",
              borderLeft: "1px solid var(--ds-hairline-soft)",
            }}
          >
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Site title + description */}
              <div>
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-4/5" />
                  </div>
                ) : !error ? (
                  <>
                    <div className="flex items-center gap-2 mb-1.5">
                      <h1
                        className="text-white text-[15px] leading-tight flex-1"
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 600,
                          letterSpacing: "-0.3px",
                        }}
                      >
                        {displayTitle}
                      </h1>
                      <span
                        className="shrink-0 text-[10px] font-medium rounded-full px-2 py-0.5"
                        style={{
                          background: "var(--ds-surface-2)",
                          color: "#ffffff",
                          border: "1px solid var(--ds-hairline)",
                        }}
                      >
                        Framer
                      </span>
                    </div>
                    {(analysis?.marketplace?.description ||
                      analysis?.description) && (
                      <p className="text-[#999999] text-xs leading-relaxed">
                        {analysis?.marketplace?.description ||
                          analysis?.description}
                      </p>
                    )}
                  </>
                ) : null}
              </div>

              {!error && (
                <>
                  <div className="h-px bg-white/10" />

                  {/* Pages with checkboxes */}
                  <div>
                    <SectionLabel icon={Layers} label="Pages" />
                    {loading ? (
                      <div className="flex flex-wrap gap-1.5">
                        {[70, 52, 80, 58].map((w, i) => (
                          <Skeleton
                            key={i}
                            className="h-6 rounded-full"
                            style={{ width: w }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {(analysis?.pages || []).map((p) => (
                          <label
                            key={p}
                            className="flex items-center gap-2.5 cursor-pointer group"
                          >
                            <div
                              className="h-4 w-4 rounded flex items-center justify-center shrink-0 transition-colors border"
                              style={{
                                background: selectedPages.has(p)
                                  ? ACCENT
                                  : "transparent",
                                borderColor: selectedPages.has(p)
                                  ? ACCENT
                                  : "rgba(255,255,255,0.25)",
                              }}
                              onClick={() => togglePage(p)}
                            >
                              {selectedPages.has(p) && (
                                <Check
                                  className="h-2.5 w-2.5 text-white"
                                  strokeWidth={3}
                                />
                              )}
                            </div>
                            <span
                              className="text-xs transition-colors"
                              style={{
                                color: selectedPages.has(p)
                                  ? "#ffffff"
                                  : "#999999",
                              }}
                              onClick={() => togglePage(p)}
                            >
                              {p}
                            </span>
                          </label>
                        ))}
                        {(analysis?.pages || []).length === 0 && (
                          <span className="text-xs text-white/40">—</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Colors */}
                  <div>
                    <SectionLabel icon={Palette} label="Colors" />
                    {loading ? (
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Skeleton key={i} className="h-5 w-5 rounded-full" />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(analysis?.colors || []).map((c) => (
                          <div
                            key={c}
                            className="h-5 w-5 rounded-full border border-white/15 cursor-default"
                            style={{ background: c }}
                            title={c}
                          />
                        ))}
                        {(analysis?.colors || []).length === 0 && (
                          <span className="text-xs text-white/40">—</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Fonts */}
                  <div>
                    <SectionLabel icon={Type} label="Fonts" />
                    {loading ? (
                      <Skeleton className="h-4 w-2/3" />
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(analysis?.fonts || []).map((f) => (
                          <Chip key={f}>{f}</Chip>
                        ))}
                        {(analysis?.fonts || []).length === 0 && (
                          <span className="text-xs text-white/40">—</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Marketplace metadata */}
                  {!loading && analysis?.marketplace?.found && (
                    <>
                      <div className="h-px bg-white/10" />

                      {analysis.marketplace.categories &&
                        analysis.marketplace.categories.length > 0 && (
                          <div>
                            <SectionLabel icon={Tag} label="Categories" />
                            <div className="flex flex-wrap gap-1.5">
                              {analysis.marketplace.categories.map((c) => (
                                <Chip key={c}>{c}</Chip>
                              ))}
                            </div>
                          </div>
                        )}

                      {analysis.marketplace.targetAudience &&
                        analysis.marketplace.targetAudience.length > 0 && (
                          <div>
                            <SectionLabel
                              icon={Users}
                              label="Target Audience"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {analysis.marketplace.targetAudience.map((t) => (
                                <Chip key={t}>{t}</Chip>
                              ))}
                            </div>
                          </div>
                        )}

                      {analysis.marketplace.keyFeatures &&
                        analysis.marketplace.keyFeatures.length > 0 && (
                          <div>
                            <SectionLabel label="Key Features" />
                            <ul className="space-y-1.5">
                              {analysis.marketplace.keyFeatures.map((f) => (
                                <li
                                  key={f}
                                  className="flex items-start gap-2 text-xs text-[#999999]"
                                >
                                  <span className="mt-px text-white/25 shrink-0">
                                    ·
                                  </span>
                                  {f}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </>
                  )}

                  {/* Options */}
                  {!loading && (
                    <>
                      <div className="h-px bg-white/10" />
                      <div className="space-y-3">
                        <SectionLabel label="Options" />
                        <Toggle
                          checked={removeWatermark}
                          onChange={setRemoveWatermark}
                          label='Remove "Made with Framer" badge'
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* ── Clone button ── */}
            {!error && (
              <div
                className="p-4 shrink-0"
                style={{ borderTop: "1px solid var(--ds-hairline-soft)" }}
              >
                <AnimatePresence>
                  {cloning && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-3 overflow-hidden"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-[#999999]">
                          {progressLabel}
                        </span>
                        <span className="text-[10px] text-white/40 tabular-nums">
                          {Math.round(progress)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: "#ffffff" }}
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  onClick={handleClone}
                  disabled={loading || cloning}
                  className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-all active:scale-[0.98]"
                  style={{
                    background: cloned ? "#22c55e" : "#ffffff",
                    color: cloned ? "#ffffff" : "#111111",
                    opacity: loading || cloning ? 0.5 : 1,
                    cursor: loading || cloning ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && !cloning)
                      (e.currentTarget as HTMLElement).style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.opacity =
                      loading || cloning ? "0.5" : "1";
                  }}
                >
                  {cloning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Cloning…
                    </>
                  ) : cloned ? (
                    <>
                      <Check className="h-4 w-4" /> Downloaded
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" /> Clone & Download
                    </>
                  )}
                </button>

                {!loading && !cloning && (
                  <p className="text-center text-[10px] text-[#999999] mt-2">
                    HTML · CSS · Assets · Fonts
                    {removeWatermark && " · No watermark"}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}

(ClonePage as any).disableShell = true;
