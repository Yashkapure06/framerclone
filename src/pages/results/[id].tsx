import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Download,
  Eye,
  FileCode2,
  Image as ImageIcon,
  Paintbrush,
  Type,
  Code2,
  Check,
  FileText,
  ExternalLink,
  ChevronRight,
  Folder,
  FolderOpen,
  File,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CircleCheck,
  CircleAlert,
  CircleX,
  X,
  Wrench,
  Sparkles,
  RefreshCw,
  Maximize2,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { SiteSeo } from "@/components/site-seo";
import { SITE_DESCRIPTION } from "@/lib/site-config";

const serif = "var(--font-display)"; // display face (Mona Sans) — legacy variable name

interface CrawledPage {
  slug: string;
  title: string;
  url: string;
  headingCount: number;
  imageCount: number;
}

interface Manifest {
  id: string;
  url: string;
  title: string;
  description: string;
  pages: number;
  images: number;
  stylesheets: number;
  scripts: number;
  fonts: number;
  crawledPages?: CrawledPage[];
  assets: {
    images: string[];
    stylesheets: string[];
    scripts: string[];
    fonts: string[];
  };
  platform?: {
    name: string | null;
    watermarks: string[];
    watermarksRemoved: boolean;
  };
  createdAt: string;
}

interface FileNode {
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
}

const frameworks = [
  { id: "vanilla", label: "Vanilla HTML", desc: "All pages as separate HTML files with extracted CSS" },
  { id: "react", label: "React + Vite", desc: "React Router with per-page components and real CSS" },
  { id: "nextjs", label: "Next.js 15", desc: "App Router with file-based routing and extracted styles" },
] as const;

type Framework = (typeof frameworks)[number]["id"];

function fileIcon(name: string) {
  if (/\.tsx?$/.test(name)) return <FileCode2 className="h-3.5 w-3.5 text-blue-500" />;
  if (/\.css$/.test(name)) return <Paintbrush className="h-3.5 w-3.5 text-pink-500" />;
  if (/\.html$/.test(name)) return <FileCode2 className="h-3.5 w-3.5 text-orange-500" />;
  if (/\.json$/.test(name)) return <FileText className="h-3.5 w-3.5 text-amber-500" />;
  if (/\.m?js$/.test(name)) return <Code2 className="h-3.5 w-3.5 text-yellow-500" />;
  if (/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(name)) return <ImageIcon className="h-3.5 w-3.5 text-emerald-500" />;
  if (/\.(woff2?|ttf|otf|eot)$/i.test(name)) return <Type className="h-3.5 w-3.5 text-purple-500" />;
  if (/\.md$/.test(name)) return <FileText className="h-3.5 w-3.5 text-foreground/40" />;
  return <File className="h-3.5 w-3.5 text-foreground/30" />;
}

function TreeNode({
  node,
  depth = 0,
  index = 0,
}: {
  node: FileNode;
  depth?: number;
  index?: number;
  key?: React.Key;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === "file") {
    return (
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.015, duration: 0.2 }}
        className="flex items-center gap-2 rounded-lg py-1 pl-2 pr-3 transition-colors hover:bg-foreground/3"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {fileIcon(node.name)}
        <span className="text-[13px] text-foreground/70">{node.name}</span>
      </motion.div>
    );
  }

  return (
    <div>
      <motion.button
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: index * 0.015, duration: 0.2 }}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg py-1 pl-2 pr-3 text-left transition-colors hover:bg-foreground/3"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <ChevronRight
          className={`h-3 w-3 text-foreground/30 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {open ? (
          <FolderOpen className="h-3.5 w-3.5 text-foreground/50" />
        ) : (
          <Folder className="h-3.5 w-3.5 text-foreground/40" />
        )}
        <span className="text-[13px] font-medium text-foreground/80">
          {node.name}
        </span>
        {node.children && node.children.length > 0 && (
          <span className="ml-auto text-[10px] text-foreground/25">
            {node.children.length}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {node.children.map((child, i) => (
              <TreeNode
                key={child.name}
                node={child}
                depth={depth + 1}
                index={i}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ValidationCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fixable: boolean;
  fixAction?: string;
}

interface ValidationResult {
  framework: string;
  score: number;
  status: "healthy" | "minor-issues" | "issues-found";
  checks: ValidationCheck[];
  fixableCount: number;
}

interface AiBuildResult {
  provider: string;
  model: string;
  objective: string;
  framework: string;
  text: string;
  tried: Array<{ provider: string; ok: boolean; error?: string }>;
}

function ValCheckIcon({ status }: { status: ValidationCheck["status"] }) {
  if (status === "pass") return <CircleCheck className="h-4 w-4 text-emerald-500" />;
  if (status === "warn") return <CircleAlert className="h-4 w-4 text-amber-500" />;
  return <CircleX className="h-4 w-4 text-red-500" />;
}

function ValStatusBadge({ result }: { result: ValidationResult }) {
  const Icon = result.status === "healthy" ? ShieldCheck : result.status === "minor-issues" ? ShieldAlert : ShieldX;
  const color = result.status === "healthy" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25" : result.status === "minor-issues" ? "text-amber-300 bg-amber-500/10 border-amber-500/25" : "text-red-300 bg-red-500/10 border-red-500/25";
  const label = result.status === "healthy" ? "Ready to download" : result.status === "minor-issues" ? "Minor issues" : "Issues found";
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {result.score}% · {label}
    </div>
  );
}

function countNodes(nodes: FileNode[]): { files: number; folders: number } {
  let files = 0;
  let folders = 0;
  for (const n of nodes) {
    if (n.type === "file") files++;
    else {
      folders++;
      if (n.children) {
        const sub = countNodes(n.children);
        files += sub.files;
        folders += sub.folders;
      }
    }
  }
  return { files, folders };
}

export default function ResultsPage() {
  const router = useRouter();
  const { id } = router.query;
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selectedFw, setSelectedFw] = useState<Framework>("react");
  const [error, setError] = useState("");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixLog, setFixLog] = useState<string[]>([]);
  const [aiBuilding, setAiBuilding] = useState(false);
  const [aiBuildError, setAiBuildError] = useState("");
  const [aiBuild, setAiBuild] = useState<AiBuildResult | null>(null);
  const [aiFilesLoading, setAiFilesLoading] = useState(false);
  const [aiFilesError, setAiFilesError] = useState("");

  useEffect(() => {
    if (!id || typeof id !== "string") return;
    fetch(`/api/jobs/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((d) => setManifest(d))
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!id || typeof id !== "string") return;
    setTreeLoading(true);
    fetch(`/api/structure/${id}?framework=${selectedFw}`)
      .then((r) => r.json())
      .then((d) => {
        setTree(d.tree || []);
        setTreeLoading(false);
      })
      .catch(() => setTreeLoading(false));
  }, [id, selectedFw]);

  const counts = useMemo(() => countNodes(tree), [tree]);

  const crawledPageItems = manifest?.crawledPages
    ? manifest.crawledPages.map((p) => `${p.slug}: ${p.title}`)
    : ["index.html"];

  const assetCategories = manifest
    ? [
        { icon: FileCode2, label: "Crawled Pages", count: manifest.pages, items: crawledPageItems },
        { icon: Paintbrush, label: "Stylesheets", count: manifest.stylesheets, items: manifest.assets.stylesheets },
        { icon: ImageIcon, label: "Images", count: manifest.images, items: manifest.assets.images },
        { icon: Code2, label: "Scripts", count: manifest.scripts, items: manifest.assets.scripts },
        { icon: Type, label: "Fonts", count: manifest.fonts, items: manifest.assets.fonts },
      ]
    : [];

  const fixableChecks = validation?.checks.filter((c) => c.fixable && c.status !== "pass") || [];

  async function runValidation() {
    if (!manifest) return;
    setValidating(true);
    setShowValidation(false);
    setFixLog([]);
    try {
      const r = await fetch(`/api/validate/${manifest.id}?framework=${selectedFw}`);
      const data: ValidationResult = await r.json();
      setValidation(data);
      setShowValidation(true);
      return data;
    } catch {
      return null;
    } finally {
      setValidating(false);
    }
  }

  async function autoFixAll() {
    if (!manifest || fixableChecks.length === 0) return;
    setFixing(true);
    setFixLog([]);

    const actions = fixableChecks
      .map((c) => c.fixAction)
      .filter((a): a is string => !!a);

    try {
      const r = await fetch(`/api/fix/${manifest.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions }),
      });
      const data = await r.json();
      const logs: string[] = [];
      if (data.actions) {
        for (const a of data.actions as { label: string; appliedTo: number }[]) {
          logs.push(`✓ ${a.label} (${a.appliedTo} file${a.appliedTo !== 1 ? "s" : ""})`);
        }
      }
      setFixLog(logs);

      await new Promise((resolve) => setTimeout(resolve, 400));
      await runValidation();
    } catch {
      setFixLog(["Fix request failed. Please try downloading as-is."]);
    } finally {
      setFixing(false);
    }
  }

  async function fixSingleCheck(check: ValidationCheck) {
    if (!manifest || !check.fixAction) return;
    setFixing(true);
    setFixLog([]);
    try {
      const r = await fetch(`/api/fix/${manifest.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: [check.fixAction] }),
      });
      const data = await r.json();
      if (data.actions) {
        setFixLog(data.actions.map((a: { label: string; appliedTo: number }) => `✓ ${a.label} (${a.appliedTo} file${a.appliedTo !== 1 ? "s" : ""})`));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      await runValidation();
    } catch {
      setFixLog(["Fix failed"]);
    } finally {
      setFixing(false);
    }
  }

  async function runAiBuild() {
    if (!manifest) return;
    setAiBuilding(true);
    setAiBuildError("");
    try {
      const response = await fetch("/api/ai/framework-build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: manifest.id,
          framework: selectedFw,
          objective: "full-build",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "AI framework build failed");
      }
      setAiBuild(data);
    } catch (error) {
      setAiBuildError(error instanceof Error ? error.message : "AI framework build failed");
    } finally {
      setAiBuilding(false);
    }
  }

  async function downloadAiStarterPack() {
    if (!manifest) return;
    setAiFilesLoading(true);
    setAiFilesError("");
    try {
      const response = await fetch("/api/ai/framework-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: manifest.id,
          framework: selectedFw,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "AI starter pack failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${manifest.title || "site"}-${selectedFw}-ai-starter.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setAiFilesError(error instanceof Error ? error.message : "AI starter pack failed");
    } finally {
      setAiFilesLoading(false);
    }
  }

  const resultsPath = typeof id === "string" ? `/results/${id}` : "/results";

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <SiteSeo
        title={manifest ? `Results: ${manifest.title}` : "Extraction results"}
        description={manifest?.description || SITE_DESCRIPTION}
        canonicalPath={resultsPath}
        noindex
      />
      <MarketingNav />

      <div className="flex flex-1 flex-col px-6 pt-8 pb-20 md:pt-12">
        <div className="mx-auto w-full max-w-5xl">
          {/* header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
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
                  className="text-2xl text-foreground md:text-3xl"
                  style={{ fontFamily: serif, fontWeight: 500, letterSpacing: "-1.2px" }}
                >
                  Extraction results.
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

            {manifest && (
              <div className="flex items-center gap-2">
                <a
                  href={`/preview/${manifest.id}?framework=${selectedFw}`}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </a>
                <a
                  href={`/preview-full/${manifest.id}?framework=${selectedFw}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-medium text-[#111] transition-opacity hover:opacity-90"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Full Preview
                  <ExternalLink className="h-3 w-3 text-black/40" />
                </a>
              </div>
            )}
          </motion.div>

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-8 rounded-2xl border border-red-500/25 bg-red-500/10 p-6 text-sm text-red-300"
            >
              {error}
            </motion.div>
          )}

          {manifest && (
            <>
              {/* stat cards */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-5"
              >
                {[
                  { label: "Pages", value: manifest.pages },
                  { label: "Images", value: manifest.images },
                  { label: "CSS", value: manifest.stylesheets },
                  { label: "Scripts", value: manifest.scripts },
                  { label: "Fonts", value: manifest.fonts },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl border border-border/60 bg-muted/20 p-4 text-center"
                  >
                    <p className="text-2xl font-semibold text-foreground" style={{ fontFamily: serif }}>
                      {s.value}
                    </p>
                    <p className="text-xs text-foreground/45">{s.label}</p>
                  </div>
                ))}
              </motion.div>

              {/* platform badge */}
              {manifest.platform?.name && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.07 }}
                  className="mt-4 flex items-center gap-3 rounded-xl border border-input bg-card px-4 py-3"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-[10px] font-bold text-[#111]">
                    {manifest.platform.name.charAt(0)}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">
                      Built with {manifest.platform.name}
                    </p>
                    {manifest.platform.watermarks.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {manifest.platform.watermarksRemoved
                          ? `${manifest.platform.watermarks.length} watermark${manifest.platform.watermarks.length > 1 ? "s" : ""} removed during extraction`
                          : `${manifest.platform.watermarks.length} watermark${manifest.platform.watermarks.length > 1 ? "s" : ""} detected`}
                      </p>
                    )}
                  </div>
                </motion.div>
              )}

              {/* extracted files */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mt-8"
              >
                <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground" style={{ fontFamily: serif }}>
                  Extracted files
                </h2>
                <div className="space-y-3">
                  {assetCategories.map((cat) => (
                    <details key={cat.label} className="group rounded-xl border border-input bg-card">
                      <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
                        <span className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/5">
                            <cat.icon className="h-4 w-4 text-foreground/50" />
                          </span>
                          {cat.label}
                        </span>
                        <span className="rounded-full bg-foreground/5 px-2.5 py-0.5 text-xs text-foreground/50">
                          {cat.count}
                        </span>
                      </summary>
                      <div className="border-t border-border/40 px-5 py-3">
                        {cat.items.length === 0 ? (
                          <p className="text-xs text-foreground/40">No files found</p>
                        ) : (
                          <ul className="max-h-48 space-y-1 overflow-y-auto">
                            {cat.items.slice(0, 20).map((item, i) => (
                              <li key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground/55 transition-colors hover:bg-muted hover:text-foreground">
                                <FileText className="h-3 w-3 shrink-0" />
                                <span className="truncate">{item}</span>
                              </li>
                            ))}
                            {cat.items.length > 20 && (
                              <li className="px-2 py-1.5 text-xs text-foreground/40">+{cat.items.length - 20} more...</li>
                            )}
                          </ul>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </motion.div>

              {/* framework picker + file tree */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="mt-10"
              >
                <h2 className="mb-2 text-lg font-semibold tracking-tight text-foreground" style={{ fontFamily: serif }}>
                  Generate project
                </h2>
                <p className="mb-6 text-sm text-foreground/50">
                  All {manifest.pages} crawled pages will be converted to routes with real content and the original CSS included.
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                  {frameworks.map((fw) => (
                    <motion.button
                      key={fw.id}
                      whileHover={{ y: -3 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setSelectedFw(fw.id);
                        setValidation(null);
                        setShowValidation(false);
                        setFixLog([]);
                        setAiBuild(null);
                        setAiBuildError("");
                        setAiFilesError("");
                      }}
                      className={`relative rounded-xl border p-5 text-left transition-all ${
                        selectedFw === fw.id
                          ? "border-white/40 bg-card"
                          : "border-input bg-card/50 hover:border-white/20"
                      }`}
                    >
                      {selectedFw === fw.id && (
                        <span className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[#111]">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                      <p className="text-sm font-semibold text-foreground">{fw.label}</p>
                      <p className="mt-1 text-xs text-foreground/45">{fw.desc}</p>
                    </motion.button>
                  ))}
                </div>

                {/* file tree */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedFw}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.25 }}
                    className="mt-6 rounded-xl border border-input bg-card"
                  >
                    <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Folder className="h-4 w-4 text-foreground/40" />
                        <p className="text-sm font-medium text-foreground">Project structure</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-foreground/40">
                        <span>{counts.folders} folders</span>
                        <span className="h-3 w-px bg-border" />
                        <span>{counts.files} files</span>
                      </div>
                    </div>

                    <div className="max-h-[420px] overflow-y-auto p-3">
                      {treeLoading ? (
                        <div className="flex items-center justify-center py-10">
                          <Loader2 className="h-5 w-5 animate-spin text-foreground/30" />
                        </div>
                      ) : tree.length === 0 ? (
                        <p className="py-6 text-center text-xs text-foreground/40">No structure available</p>
                      ) : (
                        tree.map((node, i) => (
                          <TreeNode key={node.name} node={node} index={i} />
                        ))
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18 }}
                className="mt-8"
              >
                <div className="rounded-2xl border border-input bg-card">
                  <div className="flex flex-col gap-3 border-b border-border/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2
                        className="text-lg font-semibold tracking-tight text-foreground"
                        style={{ fontFamily: serif }}
                      >
                        AI framework architect
                      </h2>
                      <p className="mt-1 text-sm text-foreground/50">
                        Generate stronger {frameworks.find((f) => f.id === selectedFw)?.label} implementation guidance from this extracted job.
                      </p>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      disabled={aiBuilding}
                      onClick={() => runAiBuild()}
                      className="flex items-center justify-center gap-2 rounded-full bg-secondary px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      {aiBuilding ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Building plan...</>
                      ) : (
                        <><Sparkles className="h-4 w-4" /> AI build plan</>
                      )}
                    </motion.button>
                  </div>

                  {aiBuildError && (
                    <div className="border-b border-red-500/25 bg-red-500/10 px-5 py-3 text-sm text-red-300">
                      {aiBuildError}
                    </div>
                  )}

                  {aiFilesError && (
                    <div className="border-b border-red-500/25 bg-red-500/10 px-5 py-3 text-sm text-red-300">
                      {aiFilesError}
                    </div>
                  )}

                  {aiBuild ? (
                    <div className="space-y-4 px-5 py-5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-foreground/5 px-3 py-1 text-foreground/65">
                          Provider: {aiBuild.provider}
                        </span>
                        <span className="rounded-full bg-foreground/5 px-3 py-1 text-foreground/65">
                          Model: {aiBuild.model}
                        </span>
                        <span className="rounded-full bg-foreground/5 px-3 py-1 text-foreground/65">
                          Objective: {aiBuild.objective}
                        </span>
                      </div>

                      <pre className="overflow-x-auto rounded-2xl border border-input bg-black/40 p-5 text-xs leading-relaxed whitespace-pre-wrap text-white/85">
                        {aiBuild.text}
                      </pre>

                      {aiBuild.tried.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {aiBuild.tried.map((attempt) => (
                            <span
                              key={`${attempt.provider}-${attempt.ok ? "ok" : "fail"}`}
                              className={`rounded-full px-3 py-1 text-[11px] ${
                                attempt.ok
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : "bg-amber-500/10 text-amber-400"
                              }`}
                            >
                              {attempt.provider}: {attempt.ok ? "ok" : "failed"}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={aiFilesLoading}
                          onClick={() => downloadAiStarterPack()}
                          className="flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-[#111] transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {aiFilesLoading ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Building zip...</>
                          ) : (
                            <><Download className="h-4 w-4" /> Download AI starter pack</>
                          )}
                        </motion.button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-5 py-5 text-sm text-foreground/45">
                      Use AI after extraction to get component boundaries, architecture direction, and cleaner implementation ideas before export.
                    </div>
                  )}
                </div>
              </motion.div>

              {/* validate + fix + download */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mt-8"
              >
                <AnimatePresence mode="wait">
                  {showValidation && validation && (
                    <motion.div
                      key="validation"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-4 overflow-hidden rounded-2xl border border-input bg-card"
                    >
                      <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
                        <div className="flex items-center gap-3">
                          <p className="text-sm font-medium text-foreground">Code Health Report</p>
                          <ValStatusBadge result={validation} />
                        </div>
                        <button onClick={() => setShowValidation(false)} className="rounded-lg p-1 text-foreground/30 transition-colors hover:bg-muted hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {/* fix all banner */}
                      {fixableChecks.length > 0 && (
                        <div className="flex items-center justify-between border-b border-border/30 bg-amber-500/10 px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Wrench className="h-4 w-4 text-amber-400" />
                            <p className="text-xs font-medium text-amber-300">
                              {fixableChecks.length} issue{fixableChecks.length > 1 ? "s" : ""} can be auto-fixed
                            </p>
                          </div>
                          <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            disabled={fixing}
                            onClick={autoFixAll}
                            className="flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                          >
                            {fixing ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> Fixing&hellip;</>
                            ) : (
                              <><Sparkles className="h-3 w-3" /> Fix All Issues</>
                            )}
                          </motion.button>
                        </div>
                      )}

                      {/* fix log */}
                      <AnimatePresence>
                        {fixLog.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="border-b border-border/30 bg-emerald-500/10 px-5 py-3"
                          >
                            {fixLog.map((log, i) => (
                              <motion.p
                                key={i}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="text-xs text-emerald-400"
                              >
                                {log}
                              </motion.p>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* checks list */}
                      <div className="divide-y divide-border/30">
                        {validation.checks.map((check, i) => (
                          <motion.div
                            key={check.id}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.025 }}
                            className="flex items-start gap-3 px-5 py-3"
                          >
                            <div className="mt-0.5"><ValCheckIcon status={check.status} /></div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">{check.label}</p>
                              <p className="mt-0.5 text-xs leading-relaxed text-foreground/50">{check.detail}</p>
                            </div>
                            {check.fixable && check.status !== "pass" && (
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={fixing}
                                onClick={() => fixSingleCheck(check)}
                                className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                              >
                                <Wrench className="h-3 w-3" />
                                Fix
                              </motion.button>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex flex-col gap-3 sm:flex-row">
                  {/* Validate button */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={validating || fixing}
                    onClick={() => runValidation()}
                    className={`flex items-center justify-center gap-2 rounded-full border px-6 py-3.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                      validation && showValidation
                        ? validation.status === "healthy"
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                          : "border-amber-500/25 bg-amber-500/10 text-amber-300"
                        : "border-input bg-secondary text-foreground hover:bg-accent"
                    }`}
                  >
                    {validating ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Validating&hellip;</>
                    ) : validation && showValidation ? (
                      <><RefreshCw className="h-4 w-4" /> Re-validate</>
                    ) : (
                      <><ShieldCheck className="h-4 w-4" /> Validate</>
                    )}
                  </motion.button>

                  {/* Auto-fix button (only when issues exist) */}
                  {validation && showValidation && fixableChecks.length > 0 && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      disabled={fixing}
                      onClick={autoFixAll}
                      className="flex items-center justify-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-6 py-3.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {fixing ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Fixing&hellip;</>
                      ) : (
                        <><Sparkles className="h-4 w-4" /> Fix {fixableChecks.length} Issue{fixableChecks.length > 1 ? "s" : ""}</>
                      )}
                    </motion.button>
                  )}

                  {/* Download button */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      window.location.href = `/api/download/${manifest.id}?framework=${selectedFw}`;
                    }}
                    className="relative flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-medium text-[#111] transition-opacity hover:opacity-90"
                  >
                    <Download className="h-4 w-4" />
                    Download {frameworks.find((f) => f.id === selectedFw)?.label} (.zip)
                    {!validation && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">!</span>
                    )}
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      window.location.href = `/api/download/${manifest.id}?framework=${selectedFw}&ai=1`;
                    }}
                    className="flex items-center justify-center gap-2 rounded-full bg-secondary py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:px-6"
                  >
                    <Sparkles className="h-4 w-4" />
                    AI-enhanced export
                  </motion.button>

                  <motion.a
                    href={`/preview-full/${manifest.id}?framework=${selectedFw}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center justify-center gap-2 rounded-full bg-secondary py-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:flex-initial sm:px-6"
                  >
                    <Maximize2 className="h-4 w-4" />
                    Full Preview
                    <ExternalLink className="h-3 w-3 text-foreground/30" />
                  </motion.a>
                </div>
              </motion.div>
            </>
          )}
        </div>
      </div>

      <MarketingFooter />
    </main>
  );
}

(ResultsPage as any).disableShell = true;
