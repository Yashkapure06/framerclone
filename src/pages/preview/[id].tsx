import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  Monitor,
  Smartphone,
  Tablet,
  Loader2,
  Download,
  Code2,
  Check,
  AlertTriangle,
  Wrench,
  Maximize2,
} from "lucide-react";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing/marketing-nav";
import { SiteSeo } from "@/components/site-seo";
import { SITE_DESCRIPTION } from "@/lib/site-config";

const serif = "var(--font-display)";

type Viewport = "desktop" | "tablet" | "mobile";

const viewports: {
  key: Viewport;
  icon: typeof Monitor;
  w: string;
  label: string;
}[] = [
  { key: "desktop", icon: Monitor, w: "100%", label: "Desktop" },
  { key: "tablet", icon: Tablet, w: "768px", label: "Tablet" },
  { key: "mobile", icon: Smartphone, w: "375px", label: "Mobile" },
];

const frameworks = [
  { id: "vanilla", label: "Vanilla HTML", color: "bg-orange-500" },
  { id: "react", label: "React", color: "bg-blue-500" },
  { id: "nextjs", label: "Next.js", color: "bg-foreground" },
] as const;

type Framework = (typeof frameworks)[number]["id"];

interface Manifest {
  id: string;
  url: string;
  title: string;
  pages: number;
  images: number;
  stylesheets: number;
  fonts: number;
}

interface ValidationResult {
  score: number;
  status: "healthy" | "minor-issues" | "issues-found";
  fixableCount: number;
  checks: { id: string; status: string; fixable: boolean }[];
}

function parseFramework(value: unknown): Framework {
  if (typeof value === "string" && ["vanilla", "react", "nextjs"].includes(value)) {
    return value as Framework;
  }
  return "vanilla";
}

export default function PreviewPage() {
  const router = useRouter();
  const { id, framework: fwQuery } = router.query;
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [loading, setLoading] = useState(true);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const selectedFw = parseFramework(fwQuery);

  useEffect(() => {
    if (!id || typeof id !== "string") return;
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => setManifest(d))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id || typeof id !== "string") return;
    fetch(`/api/validate/${id}?framework=${selectedFw}`)
      .then((r) => r.json())
      .then((d: ValidationResult) => setValidation(d))
      .catch(() => {});
  }, [id, selectedFw]);

  const iframeSrc = id ? `/api/preview-rendered/${id}?framework=${selectedFw}` : "";

  const issueCount = validation
    ? validation.checks.filter((c) => c.status !== "pass").length
    : 0;
  const fixableCount = validation?.fixableCount || 0;

  const previewPath = typeof id === "string" ? `/preview/${id}` : "/preview";

  const handleFrameworkChange = (framework: Framework) => {
    if (!id || typeof id !== "string" || framework === selectedFw) return;
    setLoading(true);
    setValidation(null);
    router.replace(
      {
        pathname: router.pathname,
        query: { id, framework },
      },
      undefined,
      { shallow: true },
    );
  };

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <SiteSeo
        title={manifest ? `Preview: ${manifest.title}` : "Live preview"}
        description={SITE_DESCRIPTION}
        canonicalPath={previewPath}
        noindex
      />
      <MarketingNav />

      <div className="flex flex-1 flex-col px-6 pt-4 pb-10">
        <div className="mx-auto w-full max-w-7xl">
          {/* toolbar */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"
          >
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border transition-colors hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h1
                  className="text-xl font-semibold tracking-tight text-foreground"
                  style={{ fontFamily: serif }}
                >
                  {manifest?.title || "Preview"}
                </h1>
                {manifest?.url && (
                  <a
                    href={manifest.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-foreground/45 transition-colors hover:text-foreground"
                  >
                    {manifest.url} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* framework picker */}
              <div className="flex rounded-xl border border-border p-1">
                {frameworks.map((fw) => (
                  <button
                    key={fw.id}
                    onClick={() => handleFrameworkChange(fw.id)}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all ${
                      selectedFw === fw.id
                        ? "bg-foreground text-white shadow-sm"
                        : "text-foreground/45 hover:text-foreground"
                    }`}
                  >
                    {selectedFw === fw.id && (
                      <span className={`h-1.5 w-1.5 rounded-full ${fw.color}`} />
                    )}
                    {fw.label}
                  </button>
                ))}
              </div>

              {/* viewport picker */}
              <div className="flex rounded-xl border border-border p-1">
                {viewports.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setViewport(v.key)}
                    className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
                      viewport === v.key
                        ? "bg-foreground text-white"
                        : "text-foreground/45 hover:text-foreground"
                    }`}
                  >
                    <v.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{v.label}</span>
                  </button>
                ))}
              </div>

              {/* issue badge + fix link */}
              {issueCount > 0 && (
                <Link
                  href={id ? `/results/${id}` : "#"}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                >
                  {fixableCount > 0 ? (
                    <><Wrench className="h-3.5 w-3.5" /> Fix {fixableCount} Issue{fixableCount > 1 ? "s" : ""}</>
                  ) : (
                    <><AlertTriangle className="h-3.5 w-3.5" /> {issueCount} Issue{issueCount > 1 ? "s" : ""}</>
                  )}
                </Link>
              )}

              {validation?.status === "healthy" && (
                <div className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> Healthy
                </div>
              )}

              <a
                href={id ? `/preview-full/${id}?framework=${selectedFw}` : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Full Preview
              </a>

              <Link
                href={id ? `/results/${id}` : "#"}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Code2 className="h-3.5 w-3.5" />
                Files
              </Link>

              <a
                href={id ? `/api/download/${id}?framework=${selectedFw}` : "#"}
                className="flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-4 text-xs font-medium text-white transition-colors hover:bg-foreground/90"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
          </motion.div>

          {/* iframe */}
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedFw}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="relative mx-auto overflow-hidden rounded-2xl border border-border bg-white shadow-sm transition-all"
              style={{
                width: viewports.find((v) => v.key === viewport)?.w,
                maxWidth: "100%",
                height: "calc(100vh - 220px)",
              }}
            >
              {loading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3" style={{ background: "var(--ds-surface-1)" }}>
                  <Loader2 className="h-6 w-6 animate-spin text-white/30" />
                  <p className="text-xs text-white/40">
                    Rendering{" "}
                    {frameworks.find((f) => f.id === selectedFw)?.label}{" "}
                    preview&hellip;
                  </p>
                </div>
              )}
              {iframeSrc && (
                <iframe
                  src={iframeSrc}
                  className="h-full w-full"
                  onLoad={() => setLoading(false)}
                  title={`${frameworks.find((f) => f.id === selectedFw)?.label} Preview`}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

(PreviewPage as any).disableShell = true;
