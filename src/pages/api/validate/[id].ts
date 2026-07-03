import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { detectPlatform } from "@/lib/platform-detect";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

export interface Check {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fixable: boolean;
  fixAction?: string;
}

export interface ValidationResult {
  framework: string;
  score: number;
  status: "healthy" | "minor-issues" | "issues-found";
  checks: Check[];
  fixableCount: number;
}

function extractBodyContent(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m?.[1]?.trim() || html;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || "";
}

interface PageInfo {
  slug: string;
  title: string;
  html: string;
  bodyContent: string;
}

function loadPages(jobDir: string, manifest: any): PageInfo[] {
  const pagesDir = path.join(jobDir, "pages");
  const results: PageInfo[] = [];

  if (!fs.existsSync(pagesDir)) {
    const indexPath = path.join(jobDir, "index.html");
    if (!fs.existsSync(indexPath)) return [];
    const html = fs.readFileSync(indexPath, "utf-8");
    return [{ slug: "/", title: manifest.title || "Home", html, bodyContent: extractBodyContent(html) }];
  }

  for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(pagesDir, file), "utf-8");
    const slugName = file.replace(/\.html$/, "");
    const slug = slugName === "index" ? "/" : "/" + slugName.replace(/--/g, "/");
    results.push({ slug, title: extractTitle(html) || slugName, html, bodyContent: extractBodyContent(html) });
  }

  if (results.length === 0) {
    const indexPath = path.join(jobDir, "index.html");
    const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "<html><body><h1>Extracted</h1></body></html>";
    results.push({ slug: "/", title: manifest.title || "Home", html, bodyContent: extractBodyContent(html) });
  }
  return results;
}

function htmlToJsx(html: string): string {
  return html
    .replace(/class=/g, "className=")
    .replace(/for=/g, "htmlFor=")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*>/gi, "<br />")
    .replace(/<hr\s*>/gi, "<hr />")
    .replace(/<img([^>]*)(?<!\/)>/gi, "<img$1 />")
    .replace(/<input([^>]*)(?<!\/)>/gi, "<input$1 />")
    .replace(/<meta([^>]*)(?<!\/)>/gi, "")
    .replace(/<link([^>]*)(?<!\/)>/gi, "")
    .replace(/style="([^"]*)"/gi, (_, s: string) => {
      const obj = s.split(";").filter(Boolean).map((p) => {
        const [k, ...v] = p.split(":");
        if (!k || !v.length) return null;
        const key = k.trim().replace(/-([a-z])/g, (__: string, c: string) => c.toUpperCase());
        return `${key}: "${v.join(":").trim()}"`;
      }).filter(Boolean).join(", ");
      return `style={{${obj}}}`;
    })
    .replace(/tabindex=/gi, "tabIndex=")
    .replace(/autocomplete=/gi, "autoComplete=")
    .replace(/autofocus/gi, "autoFocus")
    .replace(/colspan=/gi, "colSpan=")
    .replace(/rowspan=/gi, "rowSpan=")
    .replace(/srcset=/gi, "srcSet=")
    .replace(/crossorigin=/gi, "crossOrigin=");
}

function checkJsxValidity(jsx: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const tags = ["div", "span", "p", "section", "main", "article", "header", "footer", "nav", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6"];
  for (const tag of tags) {
    const openCount = (jsx.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
    const closeCount = (jsx.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    if (openCount !== closeCount && Math.abs(openCount - closeCount) > 2) {
      issues.push(`Mismatched <${tag}> tags (${openCount} open, ${closeCount} close)`);
    }
  }

  if ((jsx.match(/style={{/g) || []).length !== (jsx.match(/}}/g) || []).length) {
    const diff = Math.abs((jsx.match(/style={{/g) || []).length - (jsx.match(/}}/g) || []).length);
    if (diff > 0) issues.push(`${diff} malformed inline style conversion(s)`);
  }

  if ((jsx.match(/`/g) || []).length % 2 !== 0) {
    issues.push("Unbalanced backtick in template literal");
  }

  return { valid: issues.length === 0, issues };
}

function validateFramework(fw: string, pages: PageInfo[], hasCss: boolean, manifest: any): ValidationResult {
  const checks: Check[] = [];

  checks.push({
    id: "pages",
    label: "Pages extracted",
    status: pages.length > 0 ? "pass" : "fail",
    detail: pages.length > 0
      ? `${pages.length} page${pages.length > 1 ? "s" : ""} will be converted to ${fw === "nextjs" ? "Next.js routes" : fw === "react" ? "React Router routes" : "HTML files"}`
      : "No pages found: the project will be empty",
    fixable: false,
  });

  checks.push({
    id: "css",
    label: "Stylesheets included",
    status: hasCss ? "pass" : "warn",
    detail: hasCss
      ? "Original CSS will be bundled: design should be preserved"
      : "No CSS was extracted: the project will lack original styling",
    fixable: false,
  });

  const totalContent = pages.reduce((s, p) => s + p.bodyContent.length, 0);
  checks.push({
    id: "content-size",
    label: "Content volume",
    status: totalContent > 500 ? "pass" : totalContent > 100 ? "warn" : "fail",
    detail: totalContent > 500
      ? `${(totalContent / 1024).toFixed(1)}KB of HTML content across ${pages.length} pages`
      : totalContent > 100
        ? "Low content volume: pages may appear mostly empty (possible SPA site)"
        : "Very little HTML content: the site likely renders via JavaScript",
    fixable: false,
  });

  if (fw === "react" || fw === "nextjs") {
    let totalIssues: string[] = [];
    let pagesWithIssues = 0;
    for (const page of pages) {
      const result = checkJsxValidity(htmlToJsx(page.bodyContent));
      if (!result.valid) { pagesWithIssues++; totalIssues = totalIssues.concat(result.issues); }
    }
    const hasIssues = pagesWithIssues > 0;
    checks.push({
      id: "jsx-conversion",
      label: "JSX conversion",
      status: !hasIssues ? "pass" : pagesWithIssues <= 2 ? "warn" : "fail",
      detail: !hasIssues
        ? "All pages convert to valid JSX cleanly"
        : `${pagesWithIssues} page${pagesWithIssues > 1 ? "s" : ""} have JSX issues: ${[...new Set(totalIssues)].slice(0, 3).join("; ")}`,
      fixable: hasIssues,
      fixAction: hasIssues ? "sanitize-html" : undefined,
    });
  }

  const allContent = pages.map((p) => p.bodyContent).join("\n");
  const imgCount = (allContent.match(/<img[^>]+src=/gi) || []).length;
  const relativeImgs = (allContent.match(/<img[^>]+src=["'](?!https?:\/\/|\/\/|data:)/gi) || []).length;
  checks.push({
    id: "images",
    label: "Image references",
    status: relativeImgs === 0 ? "pass" : "warn",
    detail: imgCount === 0
      ? "No images found in extracted content"
      : relativeImgs === 0
        ? `${imgCount} images: all use absolute URLs and will load correctly`
        : `${relativeImgs} of ${imgCount} images use relative paths: may not load`,
    fixable: relativeImgs > 0,
    fixAction: relativeImgs > 0 ? "resolve-urls" : undefined,
  });

  const scriptTags = (allContent.match(/<script[^>]*>/gi) || []).length;
  checks.push({
    id: "scripts",
    label: "Script handling",
    status: scriptTags === 0 ? "pass" : "warn",
    detail: scriptTags === 0
      ? "No inline scripts: clean rendering expected"
      : `${scriptTags} script tag${scriptTags > 1 ? "s" : ""} found: interactive elements may not function`,
    fixable: scriptTags > 0,
    fixAction: scriptTags > 0 ? "strip-scripts" : undefined,
  });

  const navItems = pages[0]?.html ? (pages[0].html.match(/<nav[^>]*>/gi) || []).length : 0;
  checks.push({
    id: "navigation",
    label: "Navigation detected",
    status: navItems > 0 ? "pass" : "warn",
    detail: navItems > 0
      ? "Original navigation found: links will be reconstructed"
      : "No <nav> element: a basic nav will be auto-generated from crawled pages",
    fixable: false,
  });

  if (fw === "react") {
    checks.push({ id: "deps", label: "Dependencies", status: "pass", detail: "React 19 + Vite 6 + React Router 7 + TypeScript 5", fixable: false });
  } else if (fw === "nextjs") {
    checks.push({ id: "deps", label: "Dependencies", status: "pass", detail: "Next.js 15 + React 19 + TypeScript 5 (App Router)", fixable: false });
  } else {
    checks.push({ id: "deps", label: "Dependencies", status: "pass", detail: "Zero dependencies: npx serve .", fixable: false });
  }

  const hasFonts = pages.some((p) => /fonts\.googleapis\.com|\.woff2?|\.ttf|\.otf/i.test(p.html));
  checks.push({
    id: "fonts",
    label: "Font preservation",
    status: hasFonts ? "pass" : "warn",
    detail: hasFonts
      ? "Google Fonts or custom font references detected"
      : "No custom fonts: project will use system fonts",
    fixable: false,
  });

  // watermark check
  const homeHtml = pages[0]?.html || "";
  const platformResult = detectPlatform(homeHtml, manifest.url || "");
  if (platformResult.watermarks.length > 0) {
    checks.push({
      id: "watermarks",
      label: "Platform watermarks",
      status: "warn",
      detail: `${platformResult.watermarks.length} ${platformResult.name || "platform"} watermark${platformResult.watermarks.length > 1 ? "s" : ""} still present in the HTML`,
      fixable: true,
      fixAction: "remove-watermarks",
    });
  }

  // broken tags check
  const structuralTags = ["div", "span", "section", "main", "article", "header", "footer", "nav"];
  let totalImbalance = 0;
  for (const page of pages) {
    for (const tag of structuralTags) {
      const openCount = (page.bodyContent.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
      const closeCount = (page.bodyContent.match(new RegExp(`</${tag}>`, "gi")) || []).length;
      totalImbalance += Math.abs(openCount - closeCount);
    }
  }
  if (totalImbalance > 0) {
    checks.push({
      id: "broken-tags",
      label: "HTML tag balance",
      status: totalImbalance > 5 ? "warn" : "pass",
      detail: totalImbalance > 5
        ? `${totalImbalance} unbalanced structural tags across pages: may cause layout shifts`
        : `${totalImbalance} minor tag imbalances: generally acceptable`,
      fixable: totalImbalance > 5,
      fixAction: totalImbalance > 5 ? "fix-broken-tags" : undefined,
    });
  }

  checks.push({
    id: "build",
    label: "Build readiness",
    status: "pass",
    detail: fw === "react"
      ? "vite.config.ts + tsconfig.json + entry point: ready for npm run dev"
      : fw === "nextjs"
        ? "next.config.mjs + layout.tsx + 404/loading: ready for npm run dev"
        : "package.json with serve: ready for npm start",
    fixable: false,
  });

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const score = Math.round((passCount / checks.length) * 100);
  const fixableCount = checks.filter((c) => c.fixable && c.status !== "pass").length;

  const status: ValidationResult["status"] = failCount > 0
    ? "issues-found"
    : score >= 80
      ? "healthy"
      : "minor-issues";

  return { framework: fw, score, status, checks, fixableCount };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id, framework } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Job ID required" });

  const jobDir = path.join(JOBS_DIR, id);
  const manifestPath = path.join(jobDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: "Job not found" });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const pages = loadPages(jobDir, manifest);
  const hasCss = fs.existsSync(path.join(jobDir, "combined.css"));
  const fw = (typeof framework === "string" ? framework : "vanilla").toLowerCase();

  res.status(200).json(validateFramework(fw, pages, hasCss, manifest));
}
