import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || "";
}

function loadHeadContent(jobDir: string): string {
  const p = path.join(jobDir, "head-content.html");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  return "";
}

interface PageInfo {
  slug: string;
  title: string;
  fullHtml: string;
}

function slugToFileName(slug: string): string {
  if (slug === "/") return "index";
  return slug.replace(/^\//, "").replace(/\//g, "-");
}

function loadPages(jobDir: string, manifest: any): PageInfo[] {
  const pagesDir = path.join(jobDir, "pages");
  const results: PageInfo[] = [];

  if (!fs.existsSync(pagesDir)) {
    const indexPath = path.join(jobDir, "index.html");
    if (!fs.existsSync(indexPath)) return [];
    const html = fs.readFileSync(indexPath, "utf-8");
    return [{ slug: "/", title: manifest.title || "Home", fullHtml: html }];
  }

  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html"));
  for (const file of files) {
    const html = fs.readFileSync(path.join(pagesDir, file), "utf-8");
    const slugName = file.replace(/\.html$/, "");
    const slug = slugName === "index" ? "/" : "/" + slugName.replace(/--/g, "/");
    results.push({ slug, title: extractTitle(html) || slugName, fullHtml: html });
  }

  if (results.length === 0) {
    const indexPath = path.join(jobDir, "index.html");
    const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "<html><body><h1>Extracted Site</h1></body></html>";
    results.push({ slug: "/", title: manifest.title || "Home", fullHtml: html });
  }

  return results;
}

function loadCombinedCss(jobDir: string): string {
  const p = path.join(jobDir, "combined.css");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  return "";
}

function cleanCss(css: string): string {
  return css
    .replace(/@charset\s+["'][^"']*["']\s*;/gi, "")
    .replace(/@import\s+[^;]+;/gi, "");
}

interface DiagCheck {
  label: string;
  status: "warn" | "fail";
}

function runQuickDiagnostics(pages: PageInfo[], hasCss: boolean): DiagCheck[] {
  const checks: DiagCheck[] = [];
  const totalLen = pages.reduce((s, p) => s + p.fullHtml.length, 0);

  if (totalLen < 500) {
    checks.push({ label: "Very little content extracted: site may rely on JavaScript rendering", status: "fail" });
  }
  if (!hasCss) {
    checks.push({ label: "No CSS extracted: styling will differ from original", status: "warn" });
  }
  if (pages.length === 1 && totalLen < 1000) {
    checks.push({ label: "Only 1 page with minimal content: possible SPA", status: "warn" });
  }

  return checks;
}

const toolbarCss = `
  #we-toolbar {
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 100000;
    display: flex; align-items: center; gap: 6px;
    padding: 6px 10px; border-radius: 12px;
    background: rgba(10,10,10,0.82); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    box-shadow: 0 4px 24px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.08);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11px; color: #fff; letter-spacing: 0.01em;
    opacity: 0.92; transition: opacity 0.2s;
  }
  #we-toolbar:hover { opacity: 1; }
  #we-toolbar .we-badge {
    padding: 4px 10px; border-radius: 8px; font-weight: 600; font-size: 10px; letter-spacing: 0.04em;
  }
  #we-toolbar .we-badge.vanilla { background: rgba(234,88,12,0.9); }
  #we-toolbar .we-badge.react { background: rgba(59,130,246,0.9); }
  #we-toolbar .we-badge.nextjs { background: rgba(255,255,255,0.15); }
  #we-toolbar .we-sep { width: 1px; height: 16px; background: rgba(255,255,255,0.15); }
  #we-toolbar select {
    background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px; padding: 3px 6px; font-size: 10px; font-family: inherit;
    cursor: pointer; outline: none; max-width: 140px;
  }
  #we-toolbar select option { background: #1a1a1a; color: #fff; }
  #we-toolbar .we-btn {
    background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.15);
    border-radius: 6px; padding: 3px 10px; font-size: 10px; font-family: inherit;
    cursor: pointer; transition: background 0.15s;
  }
  #we-toolbar .we-btn:hover { background: rgba(255,255,255,0.2); }

  #we-diag-bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100001;
    padding: 8px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11px; display: flex; align-items: center; gap: 10px;
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-bottom: 1px solid #fbbf24;
    color: #92400e; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  #we-diag-bar.error { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border-color: #f87171; color: #991b1b; }
  #we-diag-bar .we-diag-dismiss {
    margin-left: auto; background: none; border: none; cursor: pointer; font-size: 14px; color: inherit; opacity: 0.6;
  }
  #we-diag-bar .we-diag-dismiss:hover { opacity: 1; }
`;

function buildToolbarHtml(
  framework: string,
  pages: PageInfo[],
  activePage: string,
  manifest: any,
  diagChecks: DiagCheck[],
): string {
  const fwLabel = framework === "react" ? "React" : framework === "nextjs" ? "Next.js" : "Vanilla";

  const options = pages
    .map((pg) => {
      const fn = slugToFileName(pg.slug);
      const sel = fn === activePage ? " selected" : "";
      return `<option value="${fn}"${sel}>${pg.title} (${pg.slug})</option>`;
    })
    .join("");

  const resultsUrl = `/results/${manifest.id}`;

  let diagBar = "";
  if (diagChecks.length > 0) {
    const hasFail = diagChecks.some((c) => c.status === "fail");
    const icon = hasFail ? "⚠" : "ℹ";
    const labels = diagChecks.map((c) => c.label).join(" · ");
    diagBar = `<div id="we-diag-bar" class="${hasFail ? "error" : ""}">
      <strong>${icon}</strong>
      <span>${labels}</span>
      <a href="${resultsUrl}" target="_top" style="color:inherit;font-weight:600;text-decoration:underline;margin-left:8px">Fix →</a>
      <button class="we-diag-dismiss" onclick="this.parentElement.remove()">✕</button>
    </div>`;
  }

  return `
    ${diagBar}
    <div id="we-toolbar">
      <span class="we-badge ${framework}">${fwLabel}</span>
      <span class="we-sep"></span>
      <select onchange="var u=new URL(window.location);u.searchParams.set('page',this.value);window.location=u.toString()">
        ${options}
      </select>
      <span class="we-sep"></span>
      <button class="we-btn" onclick="window.open('${resultsUrl}','_top')">Results</button>
    </div>
  `;
}

function injectIntoHtml(
  fullHtml: string,
  cssToInject: string,
  toolbarHtml: string,
  extraCss: string,
): string {
  let out = fullHtml;

  const headInjection = `<style data-we-preview="true">${toolbarCss}\n${extraCss}</style>`;

  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${headInjection}\n</head>`);
  } else if (/<html/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${headInjection}</head>`);
  } else {
    out = `<html><head>${headInjection}</head>${out}`;
  }

  if (cssToInject) {
    const cssTag = `<style data-we-extracted="true">${cssToInject}</style>`;
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `${cssTag}\n</head>`);
    }
  }

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${toolbarHtml}\n</body>`);
  } else {
    out += toolbarHtml;
  }

  return out;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const { id, framework, page } = req.query;
  if (!id || typeof id !== "string")
    return res.status(400).json({ error: "Job ID required" });

  const jobDir = path.join(JOBS_DIR, id);
  const manifestPath = path.join(jobDir, "manifest.json");
  if (!fs.existsSync(manifestPath))
    return res.status(404).json({ error: "Job not found" });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const pages = loadPages(jobDir, manifest);
  const css = loadCombinedCss(jobDir);
  const hasCss = css.length > 0;

  const fw = (typeof framework === "string" ? framework : "vanilla").toLowerCase();
  const activePage = typeof page === "string" ? page : "index";

  const current = pages.find((p) => slugToFileName(p.slug) === activePage) || pages[0];
  if (!current) {
    res.setHeader("Content-Type", "text/html");
    return res.send("<html><body><h1>No pages found</h1></body></html>");
  }

  const diagChecks = runQuickDiagnostics(pages, hasCss);
  const toolbarHtml = buildToolbarHtml(fw, pages, activePage, manifest, diagChecks);

  const cleanedCss = hasCss ? cleanCss(css) : "";
  const html = injectIntoHtml(current.fullHtml, cleanedCss, toolbarHtml, "");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.send(html);
}
