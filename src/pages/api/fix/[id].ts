import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { stripWatermarks } from "@/lib/platform-detect";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

function resolveUrl(base: string, relative: string): string | null {
  try {
    return new URL(relative, base).toString();
  } catch {
    return null;
  }
}

function backupFile(filePath: string) {
  const bakPath = filePath + ".bak";
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(filePath, bakPath);
  }
}

function resolveRelativeUrls(html: string, baseUrl: string): string {
  const attrs = ["src", "href", "srcset", "data-src", "poster", "action"];
  let result = html;
  for (const attr of attrs) {
    result = result.replace(
      new RegExp(`(${attr}=["'])(?!https?://|//|data:|#|mailto:|tel:|javascript:)([^"']+)(["'])`, "gi"),
      (_, prefix: string, value: string, suffix: string) => {
        const resolved = resolveUrl(baseUrl, value);
        return resolved ? `${prefix}${resolved}${suffix}` : `${prefix}${value}${suffix}`;
      },
    );
  }
  result = result.replace(
    /url\((?!["']?(?:https?:\/\/|\/\/|data:))["']?([^"')]+)["']?\)/gi,
    (full, value: string) => {
      const resolved = resolveUrl(baseUrl, value);
      return resolved ? `url("${resolved}")` : full;
    },
  );
  return result;
}

function stripScriptTags(html: string): string {
  return html.replace(/<script(?![^>]*type=["']application\/(?:ld\+json|json)["'])[^>]*>[\s\S]*?<\/script>/gi, "");
}

function sanitizeHtmlClean(html: string): string {
  let result = html;
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  const selfClosing = ["br", "hr", "img", "input", "area", "base", "col", "embed", "source", "track", "wbr"];
  for (const tag of selfClosing) {
    result = result.replace(new RegExp(`<${tag}([^>]*?)(?<!/)>`, "gi"), `<${tag}$1 />`);
  }

  result = result.replace(/\s+on(?:click|load|error|mouseover|mouseout|submit|change|focus|blur|keydown|keyup|keypress)=["'][^"']*["']/gi, "");

  return result;
}

function fixBrokenTags(html: string): string {
  const tags = ["div", "span", "section", "main", "article", "header", "footer", "nav", "ul", "ol", "li", "p"];
  let result = html;

  for (const tag of tags) {
    const openMatches = result.match(new RegExp(`<${tag}[\\s>]`, "gi")) || [];
    const closeMatches = result.match(new RegExp(`</${tag}>`, "gi")) || [];
    const diff = openMatches.length - closeMatches.length;

    if (diff > 0) {
      const closers = `</${tag}>`.repeat(diff);
      const bodyEnd = result.lastIndexOf("</body>");
      if (bodyEnd !== -1) {
        result = result.slice(0, bodyEnd) + closers + result.slice(bodyEnd);
      } else {
        result += closers;
      }
    }
  }

  return result;
}

function fixCssUrls(css: string, baseUrl: string): string {
  return css.replace(
    /url\((?!["']?(?:https?:\/\/|\/\/|data:))["']?([^"')]+)["']?\)/gi,
    (full, value: string) => {
      const resolved = resolveUrl(baseUrl, value);
      return resolved ? `url("${resolved}")` : full;
    },
  );
}

interface FixAction {
  action: string;
  label: string;
  appliedTo: number;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Job ID required" });

  const jobDir = path.join(JOBS_DIR, id);
  const manifestPath = path.join(jobDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: "Job not found" });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const baseUrl = manifest.url || "";

  let body: { actions: string[] } = { actions: [] };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid body" });
  }

  const actions = body.actions || [];
  const applied: FixAction[] = [];

  const pagesDir = path.join(jobDir, "pages");
  const htmlFiles: { path: string; name: string }[] = [];

  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir).filter((n) => n.endsWith(".html"))) {
      htmlFiles.push({ path: path.join(pagesDir, f), name: f });
    }
  }
  const indexPath = path.join(jobDir, "index.html");
  if (fs.existsSync(indexPath) && !htmlFiles.some((f) => f.name === "index.html")) {
    htmlFiles.push({ path: indexPath, name: "index.html" });
  }

  if (actions.includes("resolve-urls")) {
    let count = 0;
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file.path, "utf-8");
      const fixed = resolveRelativeUrls(html, baseUrl);
      if (fixed !== html) {
        backupFile(file.path);
        fs.writeFileSync(file.path, fixed, "utf-8");
        count++;
      }
    }
    applied.push({ action: "resolve-urls", label: "Resolved relative URLs to absolute", appliedTo: count });
  }

  if (actions.includes("strip-scripts")) {
    let count = 0;
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file.path, "utf-8");
      const fixed = stripScriptTags(html);
      if (fixed !== html) {
        backupFile(file.path);
        fs.writeFileSync(file.path, fixed, "utf-8");
        count++;
      }
    }
    applied.push({ action: "strip-scripts", label: "Removed scripts (preserved JSON-LD)", appliedTo: count });
  }

  if (actions.includes("sanitize-html")) {
    let count = 0;
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file.path, "utf-8");
      const fixed = sanitizeHtmlClean(html);
      if (fixed !== html) {
        backupFile(file.path);
        fs.writeFileSync(file.path, fixed, "utf-8");
        count++;
      }
    }
    applied.push({ action: "sanitize-html", label: "Cleaned HTML (removed comments, event handlers, fixed self-closing tags)", appliedTo: count });
  }

  if (actions.includes("fix-broken-tags")) {
    let count = 0;
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file.path, "utf-8");
      const fixed = fixBrokenTags(html);
      if (fixed !== html) {
        backupFile(file.path);
        fs.writeFileSync(file.path, fixed, "utf-8");
        count++;
      }
    }
    applied.push({ action: "fix-broken-tags", label: "Balanced unclosed HTML tags", appliedTo: count });
  }

  if (actions.includes("remove-watermarks")) {
    let count = 0;
    for (const file of htmlFiles) {
      const html = fs.readFileSync(file.path, "utf-8");
      const { html: fixed, removed } = stripWatermarks(html);
      if (removed > 0) {
        backupFile(file.path);
        fs.writeFileSync(file.path, fixed, "utf-8");
        count++;
      }
    }
    applied.push({ action: "remove-watermarks", label: "Stripped platform watermarks and badges", appliedTo: count });
  }

  if (actions.includes("fix-css")) {
    const cssPath = path.join(jobDir, "combined.css");
    if (fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, "utf-8");
      const fixed = fixCssUrls(css, baseUrl);
      if (fixed !== css) {
        backupFile(cssPath);
        fs.writeFileSync(cssPath, fixed, "utf-8");
        applied.push({ action: "fix-css", label: "Resolved relative URLs in CSS", appliedTo: 1 });
      } else {
        applied.push({ action: "fix-css", label: "CSS URLs already resolved", appliedTo: 0 });
      }
    }
  }

  res.status(200).json({
    fixed: applied.length > 0,
    actions: applied,
    message: applied.length > 0
      ? `Applied ${applied.length} fix${applied.length > 1 ? "es" : ""} successfully`
      : "No fixes needed",
  });
}
