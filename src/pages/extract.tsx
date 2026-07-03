import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  Globe,
  FileCode2,
  Image as ImageIcon,
  Paintbrush,
  Check,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CircleCheck,
  CircleAlert,
  CircleX,
  Search,
  Zap,
  RotateCcw,
} from "lucide-react";

import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { SiteSeo } from "@/components/site-seo";
import { SITE_DESCRIPTION } from "@/lib/site-config";

const displayFont = "var(--font-display)";

type JobStatus = "idle" | "scanning" | "scanned" | "extracting" | "done" | "error";

interface ScanCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface ScanResult {
  url: string;
  reachable: boolean;
  checks: ScanCheck[];
  score: number;
  pageTitle: string;
  estimatedPages: number;
  recommendation: "ready" | "caution" | "risky";
  platform: { name: string | null; watermarkCount: number };
}

interface ExtractionResult {
  id: string;
  url: string;
  title: string;
  description: string;
  pages: number;
  images: number;
  stylesheets: number;
  scripts: number;
  fonts: number;
  downloadedAssets?: { images: number; favicon: boolean };
}

const progressSteps = [
  { icon: Globe, label: "Fetching homepage" },
  { icon: FileCode2, label: "Crawling internal pages" },
  { icon: Paintbrush, label: "Downloading stylesheets" },
  { icon: ImageIcon, label: "Extracting assets & fonts" },
  { icon: Check, label: "Complete" },
];

function CheckIcon({ status }: { status: ScanCheck["status"] }) {
  if (status === "pass")
    return <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "warn")
    return <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" />;
  return <CircleX className="h-4 w-4 shrink-0 text-red-500" />;
}

function ScoreBadge({ score, recommendation }: { score: number; recommendation: ScanResult["recommendation"] }) {
  const config = {
    ready: {
      icon: ShieldCheck,
      bg: "bg-emerald-500/10 border-emerald-500/25",
      text: "text-emerald-400",
      label: "Ready to extract",
    },
    caution: {
      icon: ShieldAlert,
      bg: "bg-amber-500/10 border-amber-500/25",
      text: "text-amber-400",
      label: "Extraction possible with caveats",
    },
    risky: {
      icon: ShieldX,
      bg: "bg-red-500/10 border-red-500/25",
      text: "text-red-400",
      label: "Extraction may fail",
    },
  }[recommendation];

  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-5 ${config.bg}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
        <config.icon className={`h-6 w-6 ${config.text}`} />
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-2xl font-medium ${config.text}`}
            style={{ fontFamily: displayFont, letterSpacing: "-1px" }}
          >
            {score}%
          </span>
          <span className={`text-sm font-medium ${config.text}`}>compatibility</span>
        </div>
        <p className={`text-xs ${config.text} opacity-75`}>{config.label}</p>
      </div>
    </div>
  );
}

export default function ExtractPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<JobStatus>("idle");
  const [step, setStep] = useState(0);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState("");
  const [expandChecks, setExpandChecks] = useState(false);
  const [removeWatermarks, setRemoveWatermarks] = useState(true);

  useEffect(() => {
    if (router.query.url && typeof router.query.url === "string") {
      setUrl(router.query.url);
      startScan(router.query.url);
    }
  }, [router.query.url]);

  async function startScan(targetUrl: string) {
    setStatus("scanning");
    setError("");
    setScan(null);
    setResult(null);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Scan failed");
      }

      const data: ScanResult = await res.json();
      setScan(data);
      setStatus("scanned");
    } catch (err: any) {
      setError(err.message || "Failed to scan the URL");
      setStatus("error");
    }
  }

  async function startExtraction(targetUrl: string) {
    setStatus("extracting");
    setStep(0);
    setError("");

    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ url: targetUrl, removeWatermarks }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Extraction failed");
      }

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let jobId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { type?: string; jobId?: string; id?: string; message?: string; pages?: number };
          try {
            ev = JSON.parse(line) as typeof ev;
          } catch {
            continue;
          }
          if (ev.type === "error" && ev.message) throw new Error(ev.message);
          if (ev.type === "start") {
            setStep(0);
          }
          if (ev.type === "page") {
            setStep((s) => Math.min(3, s + 1));
          }
          if (ev.type === "crawl") {
            setStep(2);
          }
          if (ev.type === "done") {
            jobId = (ev.jobId || ev.id) as string;
            setStep(3);
          }
        }
      }

      if (!jobId) throw new Error("Extraction finished without a job id");

      const jobRes = await fetch(`/api/jobs/${jobId}`);
      if (!jobRes.ok) throw new Error("Failed to fetch results");
      const jobData = await jobRes.json();

      setResult(jobData);
      setStep(4);
      setStatus("done");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setStatus("error");
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) startScan(url.trim());
  };

  const handleExtract = () => {
    if (scan?.url) startExtraction(scan.url);
  };

  const handleReset = () => {
    setStatus("idle");
    setScan(null);
    setResult(null);
    setError("");
    setStep(0);
  };

  const passChecks = scan?.checks.filter((c) => c.status === "pass") || [];
  const warnChecks = scan?.checks.filter((c) => c.status === "warn") || [];
  const failChecks = scan?.checks.filter((c) => c.status === "fail") || [];
  const visibleChecks = expandChecks
    ? scan?.checks || []
    : [...failChecks, ...warnChecks, ...passChecks].slice(0, 5);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <SiteSeo
        title="Extract a website"
        description={SITE_DESCRIPTION}
        canonicalPath="/extract"
      />
      <MarketingNav />

      <div className="flex flex-1 flex-col items-center px-6 pt-12 pb-20 md:pt-20">
        <div className="w-full max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1
              className="text-foreground"
              style={{
                fontFamily: displayFont,
                fontWeight: 500,
                fontSize: "clamp(36px, 5vw, 62px)",
                lineHeight: 1,
                letterSpacing: "-0.05em",
              }}
            >
              Extract a Framer site.
            </h1>
            <p className="mt-4 text-sm text-muted-foreground sm:text-base" style={{ letterSpacing: "-0.16px" }}>
              Paste a Framer URL. We scan it first, then extract everything
              into a production-ready project.
            </p>
          </motion.div>

          {/* URL input */}
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 flex items-center gap-3 rounded-full border border-input bg-card p-1.5 pl-3 transition-shadow focus-within:[box-shadow:rgba(0,153,255,0.15)_0_0_0_1px]"
          >
            <Globe className="ml-2 h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yoursite.framer.website"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
              required
              disabled={status === "scanning" || status === "extracting"}
            />
            <button
              type="submit"
              disabled={status === "scanning" || status === "extracting"}
              className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-[#111] transition-all hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
            >
              {status === "scanning" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Scan
                </>
              )}
            </button>
          </motion.form>

          <AnimatePresence mode="wait">
            {/* ── Scanning spinner ── */}
            {status === "scanning" && (
              <motion.div
                key="scanning"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-10 flex flex-col items-center gap-3 py-8"
              >
                <div className="relative">
                  <Loader2 className="h-8 w-8 animate-spin text-foreground/25" />
                  <Search className="absolute inset-0 m-auto h-3.5 w-3.5 text-foreground/40" />
                </div>
                <p className="text-sm text-foreground/50">
                  Running pre-flight diagnostics&hellip;
                </p>
              </motion.div>
            )}

            {/* ── Scan results ── */}
            {status === "scanned" && scan && (
              <motion.div
                key="scan-results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-8 space-y-4"
              >
                {/* title + score */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                  <div className="flex-1">
                    <p className="text-xs text-foreground/40 uppercase tracking-widest">
                      Pre-flight report
                    </p>
                    <h2
                      className="mt-1 text-xl text-foreground sm:text-2xl"
                      style={{ fontFamily: displayFont, fontWeight: 500, letterSpacing: "-0.8px" }}
                    >
                      {scan.pageTitle}
                    </h2>
                    <p className="mt-1 text-xs text-foreground/45">{scan.url}</p>
                    {scan.estimatedPages > 1 && (
                      <p className="mt-2 text-xs text-foreground/50">
                        ~{scan.estimatedPages} internal pages detected
                      </p>
                    )}
                  </div>
                  <div className="w-full sm:w-64">
                    <ScoreBadge score={scan.score} recommendation={scan.recommendation} />
                  </div>
                </div>

                {/* platform badge + watermark toggle */}
                {scan.platform?.name && (
                  <div className="flex flex-col gap-3 rounded-2xl border border-input bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-bold text-[#111]">
                        {scan.platform.name.charAt(0)}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Built with {scan.platform.name}
                        </p>
                        {scan.platform.watermarkCount > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {scan.platform.watermarkCount} watermark{scan.platform.watermarkCount > 1 ? "s" : ""} detected
                          </p>
                        )}
                      </div>
                    </div>
                    {scan.platform.watermarkCount > 0 && (
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={removeWatermarks}
                          onChange={(e) => setRemoveWatermarks(e.target.checked)}
                          className="h-4 w-4 rounded"
                          style={{ accentColor: "#fff" }}
                        />
                        <span className="text-xs font-medium text-foreground">
                          Remove watermarks
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* checks list */}
                <div className="rounded-2xl border border-input bg-card">
                  <div className="border-b border-border/40 px-5 py-3">
                    <p className="text-sm font-medium text-foreground">
                      Diagnostics
                      <span className="ml-2 text-foreground/40">
                        {passChecks.length} passed
                        {warnChecks.length > 0 &&
                          ` · ${warnChecks.length} warning${warnChecks.length > 1 ? "s" : ""}`}
                        {failChecks.length > 0 &&
                          ` · ${failChecks.length} failed`}
                      </span>
                    </p>
                  </div>

                  <div className="divide-y divide-border/30">
                    {visibleChecks.map((check, i) => (
                      <motion.div
                        key={check.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-start gap-3 px-5 py-3.5"
                      >
                        <div className="mt-0.5">
                          <CheckIcon status={check.status} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {check.label}
                          </p>
                          <p className="mt-0.5 text-xs text-foreground/50 leading-relaxed">
                            {check.detail}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {scan.checks.length > 5 && (
                    <button
                      onClick={() => setExpandChecks(!expandChecks)}
                      className="w-full border-t border-border/30 px-5 py-2.5 text-xs font-medium text-foreground/40 transition-colors hover:text-foreground"
                    >
                      {expandChecks
                        ? "Show less"
                        : `Show all ${scan.checks.length} checks`}
                    </button>
                  )}
                </div>

                {/* action buttons */}
                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleExtract}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-medium text-[#111] transition-opacity hover:opacity-90"
                  >
                    <Zap className="h-4 w-4" />
                    {scan.recommendation === "risky"
                      ? "Extract Anyway"
                      : "Proceed with Extraction"}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleReset}
                    className="flex items-center justify-center gap-2 rounded-full bg-secondary px-6 py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Try Another URL
                  </motion.button>
                </div>
              </motion.div>
            )}

            {/* ── Extraction progress ── */}
            {status === "extracting" && (
              <motion.div
                key="progress"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-10"
              >
                <div className="space-y-4">
                  {progressSteps.map((s, i) => {
                    const isActive = i === step;
                    const isDone = i < step;
                    return (
                      <motion.div
                        key={s.label}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="flex items-center gap-4"
                      >
                        <span
                          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                            isDone
                              ? "bg-white/10 text-foreground"
                              : isActive
                                ? "bg-foreground text-[#111]"
                                : "bg-muted text-foreground/30"
                          }`}
                        >
                          {isDone ? (
                            <Check className="h-4 w-4" />
                          ) : isActive ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <s.icon className="h-4 w-4" />
                          )}
                        </span>
                        <span
                          className={`text-sm font-medium ${
                            isDone
                              ? "text-foreground"
                              : isActive
                                ? "text-foreground"
                                : "text-foreground/35"
                          }`}
                        >
                          {s.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ── Extraction complete ── */}
            {status === "done" && result && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10"
              >
                <div className="rounded-2xl border border-input bg-card p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-[#111]">
                      <Check className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Extraction complete
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {result.url}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {[
                      { label: "Pages", value: result.pages },
                      { label: "Images", value: result.images },
                      { label: "CSS refs", value: result.stylesheets },
                      { label: "Scripts", value: result.scripts },
                      { label: "Fonts", value: result.fonts },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-xl border border-border/60 bg-muted/30 p-4 text-center"
                      >
                        <p className="text-2xl font-semibold text-foreground">
                          {s.value}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                    Counts reflect what we saw in static HTML (stylesheet links, script tags, font references).
                    The zip puts markup in real source files, not one giant JSON, plus combined CSS and{" "}
                    <code className="text-[11px]">public/images</code> when assets were saved.
                  </p>
                  {result.downloadedAssets != null && (
                    <p className="mt-2 text-xs text-foreground/55">
                      On disk: {result.downloadedAssets.images} image file
                      {result.downloadedAssets.images !== 1 ? "s" : ""}
                      {result.downloadedAssets.favicon ? ", favicon" : ""}.
                    </p>
                  )}

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => window.open(`/preview-full/${result.id}`, "_blank")}
                      className="flex-1 rounded-full bg-foreground py-3 text-center text-sm font-medium text-[#111] transition-opacity hover:opacity-90"
                    >
                      Full Preview ↗
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => router.push(`/results/${result.id}`)}
                      className="flex-1 rounded-full bg-secondary py-3 text-center text-sm font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      View Files & Download
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Error ── */}
            {status === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-10 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/10 p-5"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                <div>
                  <p className="text-sm font-semibold text-red-300">
                    Something went wrong
                  </p>
                  <p className="mt-1 text-xs text-red-400">{error}</p>
                  <button
                    onClick={handleReset}
                    className="mt-3 text-xs font-medium text-red-300 underline underline-offset-2 transition-colors hover:text-red-200"
                  >
                    Try again
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <MarketingFooter />
    </main>
  );
}

(ExtractPage as any).disableShell = true;
