import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import prettier from "prettier";
import {
  formatAiStarterFile,
  generateAiStarterPack,
} from "@/lib/ai-starter-pack";
import {
  splitPageIntoSections,
  sectionComponentSource,
  sectionContentKey,
  type JsxSection,
} from "@/lib/jsx-converter";
import { detectNpmDependencies } from "@/lib/detect-dependencies";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

function safeFileName(name: string) {
  return (name || "extracted-site").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").toLowerCase();
}

function slugToComponentName(slug: string): string {
  if (slug === "/") return "Home";
  return slug
    .replace(/^\//, "")
    .split(/[\/\-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function slugToFileName(slug: string): string {
  if (slug === "/") return "index";
  return slug.replace(/^\//, "").replace(/\//g, "-");
}

function extractBodyContent(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m?.[1]?.trim() || html;
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || "";
}

function extractMetaDescription(html: string): string {
  const m =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  return m?.[1]?.trim() || "";
}

function extractInternalLinksFromHtml(html: string, baseUrlStr: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrlStr);
  } catch {
    return [];
  }
  const out: string[] = [];
  const re = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]?.trim();
    if (!href || href.toLowerCase().startsWith("javascript:")) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname === base.hostname) {
        let pathname = u.pathname || "/";
        if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
        out.push(pathname || "/");
      }
    } catch {
      /* skip */
    }
  }
  return [...new Set(out)].slice(0, 40);
}

function extractPublicAssetRefs(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/\/images\/[a-zA-Z0-9._/-]+/g)) {
    if (m[0]) set.add(m[0].replace(/^\//, ""));
  }
  return [...set];
}

function dirTotalSizeKb(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let bytes = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else bytes += fs.statSync(full).size;
    }
  };
  walk(dir);
  return Math.round(bytes / 1024);
}

const PRETTIER_TEXT_EXT = /\.(js|jsx|ts|tsx|css|json|md)$/i;

const PRETTIER_OPTIONS = {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: "es5" as const,
  printWidth: 100,
  jsxSingleQuote: false,
  bracketSameLine: false,
  arrowParens: "always" as const,
};

/** Derive explicit parser so Prettier never falls back to filepath guessing (which silently fails on AI-generated JSX). */
function inferPrettierParser(filepath: string): string | undefined {
  const ext = (filepath.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "js": case "jsx": case "mjs": case "cjs": return "babel";
    case "ts": case "tsx": return "typescript";
    case "css": case "scss": return "css";
    case "json": return "json";
    case "md": return "markdown";
    default: return undefined;
  }
}

async function formatFile(content: string, filepath: string): Promise<{ output: string; ok: boolean }> {
  const parser = inferPrettierParser(filepath);
  try {
    const formatted = await prettier.format(content, {
      ...PRETTIER_OPTIONS,
      ...(parser ? { parser } : { filepath }),
    });
    return { output: formatted, ok: true };
  } catch {
    // Second attempt: if explicit parser still fails (AI JSX may have minor issues),
    // try with html parser as last resort for JSX-like content
    if (parser === "babel") {
      try {
        const formatted = await prettier.format(content, {
          ...PRETTIER_OPTIONS,
          parser: "html",
        });
        return { output: formatted, ok: true };
      } catch { /* fall through */ }
    }
    return { output: content, ok: false };
  }
}

/** Shared Prettier config written into generated projects so VS Code extension works out of the box. */
export const PRETTIER_RC = JSON.stringify(
  { ...PRETTIER_OPTIONS, trailingComma: "es5" },
  null,
  2,
);

async function formatAndZipTextFiles(
  zip: JSZip,
  entries: { path: string; content: string }[],
): Promise<{ filesFormatted: number; filesFailed: number }> {
  let filesFormatted = 0;
  let filesFailed = 0;
  for (const e of entries) {
    if (!PRETTIER_TEXT_EXT.test(e.path)) {
      zip.file(e.path, e.content);
      continue;
    }
    const { output, ok } = await formatFile(e.content, e.path);
    if (ok) filesFormatted += 1;
    else filesFailed += 1;
    zip.file(e.path, output);
  }
  return { filesFormatted, filesFailed };
}

function extractGoogleFontsLinks(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<link[^>]*href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/gi)) {
    if (m[1]) results.push(m[1]);
  }
  return [...new Set(results)];
}

/** React/Next zip: pull stylesheet + font/network hints from saved head + first page (Framer CDN, etc.). */
interface HeadLinkDesc {
  rel: string;
  href: string;
  as?: string;
  crossOrigin?: "anonymous" | "use-credentials";
}

function collectHeadInnerFragments(htmlCombined: string): string[] {
  const heads = [...htmlCombined.matchAll(/<head[^>]*>([\s\S]*?)<\/head>/gi)].map((m) => m[1] || "");
  if (heads.length > 0) return heads;
  const t = htmlCombined.trim();
  return t ? [t] : [];
}

function parseHeadLinkDescriptors(htmlCombined: string, limit = 40): HeadLinkDesc[] {
  const allowRel = new Set(["stylesheet", "preload", "preconnect", "dns-prefetch"]);
  const seen = new Set<string>();
  const out: HeadLinkDesc[] = [];

  for (const inner of collectHeadInnerFragments(htmlCombined)) {
    for (const m of inner.matchAll(/<link\s([^>]+)>/gi)) {
      const attrs = m[1];
      const relM = attrs.match(/\brel\s*=\s*["']([^"']*)["']/i);
      const hrefM = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i);
      if (!relM || !hrefM) continue;
      const rel = relM[1].toLowerCase().trim();
      if (rel === "modulepreload") continue;
      if (!allowRel.has(rel)) continue;
      if (rel === "preload") {
        const asM = attrs.match(/\bas\s*=\s*["']([^"']*)["']/i);
        const asVal = asM?.[1]?.toLowerCase() || "";
        if (asVal && asVal !== "font" && asVal !== "style" && asVal !== "image") continue;
      }
      const href = hrefM[1].trim();
      if (!href || href.toLowerCase().startsWith("javascript:")) continue;
      const key = href.split("#")[0];
      if (seen.has(key)) continue;
      seen.add(key);

      let crossOrigin: HeadLinkDesc["crossOrigin"];
      if (/\bcrossorigin\s*=\s*["']anonymous["']/i.test(attrs) || /\bcrossorigin(?!\s*=)/i.test(attrs)) {
        crossOrigin = "anonymous";
      } else if (/\bcrossorigin\s*=\s*["']use-credentials["']/i.test(attrs)) {
        crossOrigin = "use-credentials";
      }

      const asM = attrs.match(/\bas\s*=\s*["']([^"']*)["']/i);
      const as = asM?.[1];

      out.push({ rel, href, as, crossOrigin });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function formatHeadLinkTagForHtml(d: HeadLinkDesc): string {
  let line = `    <link rel=${JSON.stringify(d.rel)} href=${JSON.stringify(d.href)}`;
  if (d.as) line += ` as=${JSON.stringify(d.as)}`;
  if (d.crossOrigin) line += ` crossorigin=${JSON.stringify(d.crossOrigin)}`;
  line += " />";
  return line;
}

function nextHeadLinksJsxLines(descriptors: HeadLinkDesc[]): string {
  return descriptors
    .map((l) => {
      let s = `        <link key={${JSON.stringify(l.href)}} rel={${JSON.stringify(l.rel)}} href={${JSON.stringify(l.href)}}`;
      if (l.as) s += ` as={${JSON.stringify(l.as)}}`;
      if (l.crossOrigin) s += ` crossOrigin={${JSON.stringify(l.crossOrigin)}}`;
      s += " />";
      return s;
    })
    .join("\n");
}

function reactHeadLinkSources(jobDir: string, homePageHtml: string): string {
  return [loadHeadContent(jobDir), homePageHtml].filter(Boolean).join("\n");
}

/** Strip inline event handlers from a copied attribute string (body → wrapper). */
function stripEventHandlersFromAttributeString(attrs: string): string {
  return attrs
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Framer often sets `data-framer-root` on `<body>` while we only embed body's children.
 * Clone those attributes onto a wrapper so descendant selectors still match.
 */
function wrapBodyInnerIfFramerRootOnBody(fullHtml: string, bodyInnerSanitized: string): string {
  const open = fullHtml.match(/<body([^>]*)>/i)?.[1];
  if (!open) return bodyInnerSanitized;
  if (!/data-framer-root/i.test(open)) return bodyInnerSanitized;
  if (/data-framer-root/i.test(bodyInnerSanitized)) return bodyInnerSanitized;
  const safe = stripEventHandlersFromAttributeString(open);
  if (!safe) return bodyInnerSanitized;
  return `<div ${safe}>${bodyInnerSanitized}</div>`;
}

const REACT_NEXT_VIEWPORT_SHELL_CSS = `
/* website-extractor: viewport shell, closer match to full-document iframe preview */
html,
body,
#root {
  height: 100%;
  margin: 0;
}
#root {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.app-shell,
.app {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.we-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.we-page-host {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
`;

function loadHeadContent(jobDir: string): string {
  const p = path.join(jobDir, "head-content.html");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  return "";
}

function extractNavItems(html: string): { label: string; href: string }[] {
  const navBlock = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navBlock) return [];
  const items: { label: string; href: string }[] = [];
  for (const m of navBlock[1].matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]?.trim();
    const label = m[2]?.replace(/<[^>]+>/g, "").trim();
    if (href && label && label.length < 40) items.push({ label, href });
  }
  return items.slice(0, 8);
}

interface PageInfo {
  slug: string;
  title: string;
  html: string;
  bodyContent: string;
  /** Canonical URL of this crawled page (used to resolve relative links). */
  pageUrl: string;
}

function syntheticPageUrl(siteBase: string, slug: string): string {
  try {
    const origin = new URL(siteBase).origin;
    if (slug === "/" || slug === "") return `${origin}/`;
    const path = slug.startsWith("/") ? slug : `/${slug}`;
    return `${origin}${path}`;
  } catch {
    return siteBase;
  }
}

function resolvePageUrlForSlug(manifest: any, slug: string): string {
  const crawled = (manifest.crawledPages || []) as { slug?: string; url?: string }[];
  for (const c of crawled) {
    if (c.slug === slug && typeof c.url === "string" && c.url.length > 0) return c.url;
  }
  const base = typeof manifest.url === "string" && manifest.url.length > 0 ? manifest.url : "https://example.invalid/";
  return syntheticPageUrl(base, slug);
}

function loadPages(jobDir: string, manifest: any, dirName: "pages" | "pages-rendered" = "pages"): PageInfo[] {
  // Rendered pages (post-JS DOM) feed the static JSX exports; fall back to the
  // raw SSR pages when the extraction ran without Playwright.
  if (dirName === "pages-rendered") {
    const renderedDir = path.join(jobDir, "pages-rendered");
    const hasRendered =
      fs.existsSync(renderedDir) && fs.readdirSync(renderedDir).some((f) => f.endsWith(".html"));
    if (!hasRendered) return loadPages(jobDir, manifest, "pages");
    const rawPages = loadPages(jobDir, manifest, "pages");
    const results: PageInfo[] = [];
    for (const file of fs.readdirSync(renderedDir).filter((f) => f.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(renderedDir, file), "utf-8");
      const slugName = file.replace(/\.html$/, "");
      const slug = slugName === "index" ? "/" : "/" + slugName.replace(/--/g, "/");
      results.push({
        slug,
        title: extractTitle(html) || slugName,
        html,
        bodyContent: extractBodyContent(html),
        pageUrl: resolvePageUrlForSlug(manifest, slug),
      });
    }
    // Pages crawled without a rendered snapshot still ship, from raw HTML
    for (const raw of rawPages) {
      if (!results.some((r) => r.slug === raw.slug)) results.push(raw);
    }
    return results;
  }

  const pagesDir = path.join(jobDir, "pages");
  const results: PageInfo[] = [];

  if (!fs.existsSync(pagesDir)) {
    const indexHtml = fs.readFileSync(path.join(jobDir, "index.html"), "utf-8");
    const slug = "/";
    return [
      {
        slug,
        title: manifest.title || "Home",
        html: indexHtml,
        bodyContent: extractBodyContent(indexHtml),
        pageUrl: resolvePageUrlForSlug(manifest, slug),
      },
    ];
  }

  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html"));
  for (const file of files) {
    const html = fs.readFileSync(path.join(pagesDir, file), "utf-8");
    const slugName = file.replace(/\.html$/, "");
    const slug = slugName === "index" ? "/" : "/" + slugName.replace(/--/g, "/");
    const title = extractTitle(html) || slugName;
    results.push({
      slug,
      title,
      html,
      bodyContent: extractBodyContent(html),
      pageUrl: resolvePageUrlForSlug(manifest, slug),
    });
  }

  if (results.length === 0) {
    const indexHtml = fs.existsSync(path.join(jobDir, "index.html"))
      ? fs.readFileSync(path.join(jobDir, "index.html"), "utf-8")
      : "<html><body><h1>Extracted Site</h1></body></html>";
    const slug = "/";
    results.push({
      slug,
      title: manifest.title || "Home",
      html: indexHtml,
      bodyContent: extractBodyContent(indexHtml),
      pageUrl: resolvePageUrlForSlug(manifest, slug),
    });
  }

  return results;
}

function loadCombinedCss(jobDir: string): string {
  const p = path.join(jobDir, "combined.css");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  return "";
}

function extractInlineStylesFromSavedHtml(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)) {
    if (m[1]?.trim().length > 10) results.push(m[1].trim());
  }
  return results;
}

const MIN_MEANINGFUL_CSS = 80;
const FALLBACK_CSS = `/* website-extractor: Static crawl found almost no CSS in <link> or <style>.
   Many builders (Framer, Webflow, etc.) inject styles via JavaScript after load.
   Use the extractor's Full Preview for fidelity, or export / copy CSS from devtools. */
html, body { margin: 0; }
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; color: #111; }
`;

/** Merge combined.css with inline <style> blocks. Always merge — inline blocks often hold
 *  keyframes, CSS variables, and animation resets that combined.css misses. */
function gatherBundleCss(jobDir: string, pages: PageInfo[]): string {
  const primary = loadCombinedCss(jobDir).trim();
  const seen = new Set<string>();
  const inlineChunks: string[] = [];
  for (const page of pages) {
    for (const block of extractInlineStylesFromSavedHtml(page.html)) {
      const key = block.slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        inlineChunks.push(block);
      }
    }
  }
  if (primary.length >= MIN_MEANINGFUL_CSS) {
    return inlineChunks.length > 0
      ? `${primary}\n\n/* ─── inline <style> blocks (keyframes, vars, animation resets) ─── */\n${inlineChunks.join("\n\n")}`
      : primary;
  }
  const chunks = primary.length > 0 ? [primary, ...inlineChunks] : inlineChunks;
  const merged = chunks.join("\n\n").trim();
  if (merged.length >= MIN_MEANINGFUL_CSS) return merged;
  if (merged.length > 0) return `${merged}\n\n${FALLBACK_CSS}`;
  return FALLBACK_CSS;
}

/** Vanilla inline embed: strip @charset and @import (content already inlined by extraction). */
function cleanCssForEmbed(css: string): string {
  return css
    .replace(/@charset\s+["'][^"']*["']\s*;/gi, "")
    .replace(/@import\s+[^;]+;/gi, "");
}

/** React / Next.js .css files: only strip @charset. Keep @import so CDN animation
 *  library imports (AOS, GSAP, etc.) that weren't captured in combined.css still load. */
function cleanCssForReactNext(css: string): string {
  return css.replace(/@charset\s+["'][^"']*["']\s*;/gi, "");
}

/** Extract <style> content from <head> only — CSS vars and resets defined there are
 *  not in the body, so dangerouslySetInnerHTML never sees them. */
function extractHeadStyleBlocks(html: string): string[] {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return [];
  return extractInlineStylesFromSavedHtml(headMatch[1]);
}

interface ExternalScript { src: string; defer: boolean; async: boolean; }

/** Collect CDN script URLs from the page (skip same-origin, ES modules, and JSON-LD).
 *  These drive animations (GSAP, AOS, ScrollReveal, etc.) and must be loaded at runtime. */
function extractExternalScriptUrls(html: string, siteOrigin: string): ExternalScript[] {
  const out: ExternalScript[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<script([^>]*)>/gi)) {
    const attrs = m[1];
    if (/type=["'](?:module|application\/(?:json|ld\+json))["']/i.test(attrs)) continue;
    const srcM = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcM) continue;
    const src = srcM[1].trim();
    if (!src || src.startsWith("data:") || src.startsWith("blob:") || seen.has(src)) continue;
    seen.add(src);
    let resolved: URL;
    try { resolved = new URL(src, siteOrigin || "https://example.invalid"); } catch { continue; }
    if (siteOrigin && resolved.origin === siteOrigin) continue; // same-site → already in public/scripts
    out.push({ src, defer: /\bdefer\b/i.test(attrs), async: /\basync\b/i.test(attrs) });
  }
  return out.slice(0, 12);
}

/** Extract unique external image hostnames for next.config.mjs remotePatterns */
function extractImageRemoteHostnames(assetMap: Record<string, string>): string[] {
  const hostnames = new Set<string>();
  for (const key of Object.keys(assetMap)) {
    try {
      const u = new URL(key);
      if (u.protocol === "https:" || u.protocol === "http:") {
        hostnames.add(u.hostname);
      }
    } catch { /* skip */ }
  }
  return [...hostnames];
}

/** AnimationInit component — initializes CDN-loaded animation libs after mount */
function buildAnimationInitComponent(): string {
  return `import { useEffect, useRef } from 'react';

export default function AnimationInit() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const init = () => {
      if (typeof window === 'undefined') return;

      // GSAP + ScrollTrigger (must init after DOM ready)
      if (window.gsap && window.ScrollTrigger) {
        window.gsap.registerPlugin(window.ScrollTrigger);
        window.ScrollTrigger.refresh();
      }

      // AOS — re-init after brief delay for DOM sync
      if (window.AOS) {
        window.AOS.init({ duration: 800, once: false });
        setTimeout(() => window.AOS.refresh(), 100);
      }

      // Swiper sliders
      if (window.Swiper) {
        document.querySelectorAll('.swiper:not(.swiper-initialized)').forEach((el) => {
          new window.Swiper(el, { loop: false });
        });
      }

      // Lenis smooth scroll
      if (window.Lenis) {
        const lenis = new window.Lenis();
        const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
        requestAnimationFrame(raf);
      }

      // ScrollReveal
      if (window.ScrollReveal) window.ScrollReveal().reveal('[data-sr]');

      // Framer Motion — trigger after DOM settle
      if (window.fm) {
        requestAnimationFrame(() => {
          document.querySelectorAll('[data-framer-href], [data-framer-component-type]').forEach((el) => {
            el.dispatchEvent(new Event('motionComplete'));
          });
        });
      }

      // Other libs
      if (window.WOW) new window.WOW({ live: false }).init();
      if (window.Splitting) window.Splitting();
      if (window.GLightbox) window.GLightbox();
      if (window.Typed) {
        document.querySelectorAll('[data-typed-items]').forEach((el) => {
          const items = el.getAttribute('data-typed-items')?.split(',') || [];
          new window.Typed(el, { strings: items, loop: true, typeSpeed: 100, backSpeed: 50 });
        });
      }
    };

    // Ensure DOM is ready before initializing
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      requestAnimationFrame(init);
    }
  }, []);

  return null;
}
`;
}

function expandAssetMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...map };
  for (const [k, v] of Object.entries(map)) {
    try {
      const u = new URL(k);
      if (u.protocol === "https:") {
        const alt = `http://${u.host}${u.pathname}${u.search}`;
        if (!out[alt]) out[alt] = v;
      } else if (u.protocol === "http:") {
        const alt = `https://${u.host}${u.pathname}${u.search}`;
        if (!out[alt]) out[alt] = v;
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

function loadAssetMap(jobDir: string): Record<string, string> {
  const fp = path.join(jobDir, "asset-map.json");
  if (!fs.existsSync(fp)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, string>;
    // Normalize Windows backslashes in values to forward slashes
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      normalized[k] = typeof v === "string" ? v.replace(/\\/g, "/") : v;
    }
    return expandAssetMap(normalized);
  } catch {
    return {};
  }
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace longer URLs first to avoid partial matches */
function rewriteUrlsWithMap(text: string, map: Record<string, string>): string {
  if (!text || !Object.keys(map).length) return text;
  let out = text;
  const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [absUrl, rel] of entries) {
    out = out.replace(new RegExp(escapeForRegex(absUrl), "g"), rel);
  }
  return out;
}

/** Same path with or without trailing slash maps to one key (lowercase). */
function normalizePathKey(pathname: string): string {
  let p = pathname || "/";
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p.toLowerCase();
}

function buildPathnameToSlugMap(pages: PageInfo[], siteOrigin: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const page of pages) {
    try {
      const u = new URL(page.pageUrl);
      if (u.origin !== siteOrigin) continue;
      m.set(normalizePathKey(u.pathname), page.slug);
    } catch {
      /* skip */
    }
  }
  return m;
}

function vanillaHtmlFilename(slug: string): string {
  return slug === "/" ? "index.html" : `${slug.replace(/^\//, "").replace(/\//g, "-")}.html`;
}

function routerPathForSlug(slug: string): string {
  return slug === "/" ? "/" : slug;
}

/** Rewrite same-site <a href> and <form action> to local paths (vanilla .html or SPA /routes). */
function replaceHrefAndActionInHtml(
  html: string,
  pageBaseUrl: string,
  pathnameToSlug: Map<string, string>,
  siteOrigin: string,
  mode: "vanilla" | "spa",
): string {
  const proc = (attr: string, val: string, quote: string): string => {
    const trimmed = val.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      /^(mailto:|tel:|javascript:)/i.test(trimmed) ||
      trimmed.startsWith("data:")
    )
      return `${attr}=${quote}${val}${quote}`;
    let resolved: URL;
    try {
      resolved = new URL(trimmed, pageBaseUrl);
    } catch {
      return `${attr}=${quote}${val}${quote}`;
    }
    if (resolved.origin !== siteOrigin) return `${attr}=${quote}${val}${quote}`;
    const targetSlug = pathnameToSlug.get(normalizePathKey(resolved.pathname));
    if (targetSlug === undefined) return `${attr}=${quote}${val}${quote}`;
    const rep = mode === "vanilla" ? vanillaHtmlFilename(targetSlug) : routerPathForSlug(targetSlug);
    const out = rep + resolved.hash;
    return `${attr}=${quote}${out}${quote}`;
  };

  let out = html.replace(/\b(href|action)\s*=\s*"([^"]*)"/gi, (_f, attr: string, val: string) =>
    proc(attr, val, '"'),
  );
  out = out.replace(/\b(href|action)\s*=\s*'([^']*)'/gi, (_f, attr: string, val: string) =>
    proc(attr, val, "'"),
  );
  return out;
}

function navHrefToRouterTarget(
  rawHref: string,
  sourceUrl: string,
  pathnameToSlug: Map<string, string>,
  siteOrigin: string,
): string | null {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const base = sourceUrl.endsWith("/") ? sourceUrl : `${sourceUrl.replace(/\/+$/, "")}/`;
  try {
    const resolved = new URL(trimmed, base);
    if (resolved.origin !== siteOrigin) return null;
    const slug = pathnameToSlug.get(normalizePathKey(resolved.pathname));
    if (slug === undefined) return null;
    return routerPathForSlug(slug) + resolved.hash;
  } catch {
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      try {
        const resolved = new URL(trimmed, siteOrigin);
        const slug = pathnameToSlug.get(normalizePathKey(resolved.pathname));
        if (slug === undefined) return null;
        return routerPathForSlug(slug);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Map absolute crawled page URLs → vanilla filenames or SPA paths (for CSS url() etc.). */
function buildInternalPageAbsoluteUrlMap(
  pages: PageInfo[],
  sourceUrl: string,
  mode: "vanilla" | "spa",
): Record<string, string> {
  const map: Record<string, string> = {};
  let siteOrigin: string;
  try {
    siteOrigin = new URL(sourceUrl).origin;
  } catch {
    return map;
  }
  for (const page of pages) {
    let u: URL;
    try {
      u = new URL(page.pageUrl);
    } catch {
      continue;
    }
    if (u.origin !== siteOrigin) continue;
    const replacement = mode === "vanilla" ? vanillaHtmlFilename(page.slug) : routerPathForSlug(page.slug);
    const addKey = (key: string) => {
      const k = key.split("#")[0];
      if (map[k] === undefined) map[k] = replacement;
      try {
        const x = new URL(k);
        x.protocol = x.protocol === "https:" ? "http:" : "https:";
        const alt = x.href.split("#")[0];
        if (map[alt] === undefined) map[alt] = replacement;
      } catch {
        /* skip */
      }
    };
    addKey(u.href);
    if (u.pathname !== "/" && !u.pathname.endsWith("/")) {
      addKey(`${siteOrigin}${u.pathname}/`);
    }
  }
  return map;
}

function mapToPublicPaths(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    const dir = v.match(/^\.\/(images|scripts|fonts)\//)?.[1];
    out[k] = dir ? v.replace(`./${dir}/`, `/${dir}/`) : v;
  }
  return out;
}

function normalizeHref(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/** Drop stylesheet links we already merged into combined / extracted CSS */
function stripInlinedStylesheetLinks(html: string, baseUrl: string, inlined: string[] | undefined): string {
  if (!inlined?.length || !baseUrl) return html;
  const set = new Set(inlined);
  return html.replace(/<link\s[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m?.[1]) return tag;
    const abs = normalizeHref(m[1], baseUrl);
    if (abs && set.has(abs)) return "";
    return tag;
  });
}

function injectBundledStylesheet(html: string, hrefToInject: string): string {
  const link = `\n<link rel="stylesheet" href="${hrefToInject}" data-extracted-bundle="1" />\n`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${link}</head>`);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${link}`);
  return `<!DOCTYPE html><html><head>${link}</head><body>${html}</body></html>`;
}

function appendDirToZip(zip: JSZip, srcDir: string, destPrefix: string) {
  if (!fs.existsSync(srcDir)) return;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, ent.name);
    const dest = `${destPrefix}/${ent.name}`;
    if (ent.isDirectory()) appendDirToZip(zip, full, dest);
    else zip.file(dest, fs.readFileSync(full));
  }
}

function appendFaviconsToPrefix(zip: JSZip, jobDir: string, destPrefix: string) {
  if (!fs.existsSync(jobDir)) return;
  for (const f of fs.readdirSync(jobDir)) {
    if (/^favicon\./i.test(f)) {
      zip.file(`${destPrefix}/${f}`, fs.readFileSync(path.join(jobDir, f)));
    }
  }
}

function siteUsesFramer(manifest: any, pages: PageInfo[]): boolean {
  if (manifest.platform?.name === "Framer") return true;
  const h = pages[0]?.html || "";
  return /data-framer-root/i.test(h) || /data-framer-hydrate/i.test(h);
}

/**
 * Framer SSR often sets opacity:0 on text until motion runs, but crawled HTML has no <script>
 * (only modulepreload), so animations never complete offline; content stays invisible.
 */
function framerStaticSnapshotCss(): string {
  return `
/* ─── website-extractor: Framer static snapshot ─────────────────────────
   Framer computes animations at runtime via JS. Static HTML has no JS execution,
   so we force final visibility. For live animations, use the Full Preview (Playwright). */
[data-framer-root],
[data-framer-root] * {
  animation: none !important;
  transition: none !important;
}
[data-framer-root] [data-framer-component-type="RichTextContainer"],
[data-framer-root] [data-framer-component-type="Text"],
[data-framer-root] [data-framer-component-type="DeprecatedRichText"],
[data-framer-root] p,
[data-framer-root] h1,
[data-framer-root] h2,
[data-framer-root] h3,
[data-framer-root] h4,
[data-framer-root] h5,
[data-framer-root] h6,
[data-framer-root] span,
[data-framer-root] div {
  opacity: 1 !important;
  transform: none !important;
  visibility: visible !important;
}
/* Force opacity:0 elements visible (Framer uses this for animation start states) */
[data-framer-root] [style*="opacity:0"],
[data-framer-root] [style*="opacity: 0"],
[data-framer-root] [style*="opacity: 0"]:not(body),
[data-framer-root] [style*="will-change: transform"]:not([data-framer-anim]) {
  opacity: 1 !important;
  visibility: visible !important;
}
/* Fix hidden state overrides */
[data-framer-root] [style*="visibility: hidden"],
[data-framer-root] [style*="visibility:hidden"] {
  visibility: visible !important;
}
/* Remove animation transforms */
[data-framer-root] [data-framer-temp-hide="true"] {
  opacity: 1 !important;
}
`;
}

/** Remove Framer ES-module preloads (no scripts ship in crawl; links confuse devtools). */
function stripFramerModulePreloads(html: string): string {
  return html.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>/gi, "");
}

function applyFramerStaticHtmlFixes(html: string): string {
  return stripFramerModulePreloads(html);
}

// ─── Deterministic component generation ─────────────────────────────

/** Saved pages were deep-rewritten with page-relative prefixes (../images/).
 *  SPA exports serve assets from /public, so all of them become root-absolute. */
function normalizeAssetPathsForSpa(html: string): string {
  return html
    .replace(/(["'(=])(?:\.\.\/)+(images|fonts|scripts|css)\//g, "$1/$2/")
    .replace(/(["'(=])\.\/(images|fonts|scripts|css)\//g, "$1/$2/");
}

/** Local page-file links (./pages/about.html) → router paths (/about). */
function localPageLinkMap(pages: PageInfo[], mode: "spa" | "vanilla"): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pg of pages) {
    const safe = pg.slug === "/" ? "index" : pg.slug.replace(/^\//, "").replace(/\//g, "--");
    const target =
      mode === "spa"
        ? routerPathForSlug(pg.slug)
        : pg.slug === "/"
          ? "./index.html"
          : `./${safe}.html`;
    for (const variant of [`./pages/${safe}.html`, `../pages/${safe}.html`, `pages/${safe}.html`]) {
      map[variant] = target;
    }
    if (pg.slug === "/") {
      map["../index.html"] = target;
      map["./index.html"] = target;
    }
  }
  return map;
}

interface GeneratedArchitecture {
  /** rel path inside the project → formatted source */
  componentFiles: Map<string, string>;
  /** slug → imports + page body JSX referencing section components */
  pageBodies: Map<string, { imports: string[]; jsx: string }>;
}

/**
 * Split every page into named section components with real JSX markup.
 * Sections repeated across pages (header/footer) dedupe into shared/.
 */
function generateComponentArchitecture(
  pages: PageInfo[],
  prepareBody: (page: PageInfo) => string,
  componentDirRel: string,
  importPrefixFor: (page: PageInfo) => string,
): GeneratedArchitecture {
  const splits = pages.map((pg) => ({ pg, split: splitPageIntoSections(prepareBody(pg)) }));

  const keyCount = new Map<string, number>();
  for (const { split } of splits) {
    for (const s of split.sections) {
      const k = sectionContentKey(s.html);
      keyCount.set(k, (keyCount.get(k) || 0) + 1);
    }
  }

  const componentFiles = new Map<string, string>();
  const pageBodies = new Map<string, { imports: string[]; jsx: string }>();
  const emitted = new Map<string, { name: string; relPath: string }>();
  const globalNames = new Set<string>();

  for (const { pg, split } of splits) {
    const comp = slugToComponentName(pg.slug);
    const importPrefix = importPrefixFor(pg);
    const imports: string[] = [];
    let jsx = split.pageJsx;

    for (const s of split.sections) {
      const key = sectionContentKey(s.html);
      const existing = emitted.get(key);
      if (existing) {
        imports.push(`import ${existing.name} from '${importPrefix}/${existing.relPath}';`);
        if (existing.name !== s.name) {
          jsx = jsx.split(`<${s.name} />`).join(`<${existing.name} />`);
        }
        continue;
      }
      let name = s.name;
      let n = 2;
      while (globalNames.has(name)) name = `${s.name}${n++}`;
      globalNames.add(name);
      if (name !== s.name) jsx = jsx.split(`<${s.name} />`).join(`<${name} />`);

      const shared = (keyCount.get(key) || 0) >= 2;
      const relPath = shared ? `shared/${name}.jsx` : `${comp.toLowerCase()}/${name}.jsx`;
      const section: JsxSection = { ...s, name };
      componentFiles.set(`${componentDirRel}/${relPath}`, sectionComponentSource(section));
      emitted.set(key, { name, relPath });
      imports.push(`import ${name} from '${importPrefix}/${relPath}';`);
    }

    pageBodies.set(pg.slug, { imports, jsx });
  }

  return { componentFiles, pageBodies };
}

const USE_INTERNAL_NAVIGATION_REACT = `import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/** Intercept clicks on plain <a href="/…"> links and route client-side. */
export default function useInternalNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || /^(https?:\\/\\/|\\/\\/|#|tel:|mailto:|javascript:)/i.test(href)) return;
      e.preventDefault();
      navigate(href);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [navigate]);
}
`;

const USE_INTERNAL_NAVIGATION_NEXT = `import { useEffect } from 'react';
import { useRouter } from 'next/router';

/** Intercept clicks on plain <a href="/…"> links and route client-side. */
export default function useInternalNavigation() {
  const router = useRouter();
  useEffect(() => {
    const handler = (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || /^(https?:\\/\\/|\\/\\/|#|tel:|mailto:|javascript:)/i.test(href)) return;
      e.preventDefault();
      router.push(href);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [router]);
}
`;

// ─── Vanilla builder ────────────────────────────────────────────────

function buildVanillaProject(
  zip: JSZip,
  pages: PageInfo[],
  css: string,
  manifest: any,
  prefix: string,
  jobDir: string,
) {
  const p = (f: string) => `${prefix}/${f}`;
  const title = manifest.title || "Extracted Site";

  // Preferred path: self-contained standalone pages (CSS + Framer JS runtime
  // inlined) — exact UI and working interactions straight from index.html.
  const standaloneDir = path.join(jobDir, "standalone");
  if (fs.existsSync(path.join(standaloneDir, "index.html"))) {
    appendDirToZip(zip, standaloneDir, prefix);
    appendDirToZip(zip, path.join(jobDir, "images"), `${prefix}/images`);
    appendDirToZip(zip, path.join(jobDir, "fonts"), `${prefix}/fonts`);
    appendFaviconsToPrefix(zip, jobDir, prefix);
    zip.file(p("package.json"), JSON.stringify({
        name: prefix,
        version: "1.0.0",
        description: `Extracted from ${manifest.url} (${pages.length} pages)`,
        scripts: { start: "npx serve ." },
        devDependencies: { serve: "^14.2.0" },
      }, null, 2));
    const standaloneList = pages
      .map((pg) => `- [\`${pg.slug}\`](${pg.slug === "/" ? "index.html" : slugToFileName(pg.slug) + ".html"}): ${pg.title}`)
      .join("\n");
    zip.file(p("README.md"), `# ${title}

Extracted from [${manifest.url}](${manifest.url}) on ${new Date(manifest.createdAt || Date.now()).toLocaleDateString()}.

Every page is **self-contained** — CSS and the site's JavaScript runtime are inlined,
so animations and interactions work by opening \`index.html\` directly in a browser.
For clean routing, serve over HTTP:

\`\`\`bash
npm install
npm start
# → http://localhost:3000
\`\`\`

## Pages (${pages.length})

${standaloneList}
`);
    zip.file(p(".gitignore"), "node_modules/\n.DS_Store\n");
    return;
  }
  const baseUrl = typeof manifest.url === "string" ? manifest.url : "";
  const assetMap = loadAssetMap(jobDir);
  const inlined = manifest.inlinedStylesheetUrls as string[] | undefined;
  const framer = siteUsesFramer(manifest, pages);
  const scriptsMirrored =
    typeof manifest.downloadedAssets?.scripts === "number" && manifest.downloadedAssets.scripts > 0;
  let siteOrigin: string | null = null;
  try {
    if (baseUrl) siteOrigin = new URL(baseUrl).origin;
  } catch {
    siteOrigin = null;
  }
  const pathnameToSlug = siteOrigin ? buildPathnameToSlugMap(pages, siteOrigin) : new Map<string, string>();
  const internalPageMap = baseUrl ? buildInternalPageAbsoluteUrlMap(pages, baseUrl, "vanilla") : {};

  let cleanedCss = rewriteUrlsWithMap(cleanCssForEmbed(css), { ...assetMap, ...internalPageMap });
  if (framer) cleanedCss += framerStaticSnapshotCss();

  for (const page of pages) {
    const fname = vanillaHtmlFilename(page.slug);
    let html = page.html;
    if (baseUrl && inlined?.length) html = stripInlinedStylesheetLinks(html, baseUrl, inlined);
    html = rewriteUrlsWithMap(html, assetMap);
    // Zip layout is flat: page-relative prefixes and pages/ subdir links collapse
    html = html.replace(/(["'(=])(?:\.\.\/)+(images|fonts|scripts|css)\//g, "$1./$2/");
    html = rewriteUrlsWithMap(html, localPageLinkMap(pages, "vanilla"));
    if (siteOrigin) {
      html = replaceHrefAndActionInHtml(html, page.pageUrl, pathnameToSlug, siteOrigin, "vanilla");
    }
    if (framer && !scriptsMirrored) html = applyFramerStaticHtmlFixes(html);
    html = injectBundledStylesheet(html, "./css/extracted-styles.css");
    zip.file(p(fname), html);
  }

  zip.file(p("css/extracted-styles.css"), cleanedCss);

  appendDirToZip(zip, path.join(jobDir, "images"), `${prefix}/images`);
  appendDirToZip(zip, path.join(jobDir, "scripts"), `${prefix}/scripts`);
  appendFaviconsToPrefix(zip, jobDir, prefix);

  zip.file(p("package.json"), JSON.stringify({
      name: prefix,
      version: "1.0.0",
      description: `Extracted from ${manifest.url} (${pages.length} pages)`,
      scripts: { start: "npx serve ." },
      devDependencies: { serve: "^14.2.0" },
    }, null, 2));

  const pageList = pages.map((pg) => `- [\`${pg.slug}\`](${pg.slug === "/" ? "index.html" : slugToFileName(pg.slug) + ".html"}): ${pg.title}`).join("\n");
  const platformNote = manifest.platform?.name
    ? `\n> **Note:** This site was originally built with **${manifest.platform.name}**.${manifest.platform.watermarksRemoved ? " Platform watermarks have been removed." : ""}\n`
    : "";
  const framerNote = framer
    ? `\n> **Framer Site:** Framer computes animations via JavaScript at runtime. The \`scripts/\` folder (if present) captures some animation code, but runtime-only effects won't work. The CSS forces static visibility. For animated preview, use the Full Preview (Playwright).\n`
    : "";
  zip.file(p("README.md"), `# ${title}

Extracted from [${manifest.url}](${manifest.url}) on ${new Date(manifest.createdAt || Date.now()).toLocaleDateString()}.
${platformNote}${framerNote}
## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer (for the \`serve\` dev server)

## Quick Start

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Start the local dev server (recommended to avoid file:// quirks)
npm start

# 3. Open in browser
# → http://localhost:3000
\`\`\`

## Pages (${pages.length})

${pageList}

## Project Structure

\`\`\`
${prefix}/
├── metadata/
│   └── extraction-summary.json  # Small stats only
├── index.html              # Homepage
${pages.filter((pg) => pg.slug !== "/").map((pg) => `├── ${slugToFileName(pg.slug)}.html  # ${pg.title}`).join("\n")}
├── css/
│   └── extracted-styles.css  # Combined / inlined CSS (+ fallback note if JS-driven)
├── scripts/                  # Mirrored JS/MJS when captured (Playwright network + <script src>)
├── images/                   # Downloaded raster images (when captured)
├── package.json
└── README.md
\`\`\`

## Customization

- **Styles:** Edit \`css/extracted-styles.css\` to modify the design
- **Content:** Each HTML file is self-contained; edit directly
- **Add pages:** Create new \`.html\` files and link them from the navigation

## Deployment

Upload the entire folder to any static hosting:

- **Netlify:** Drag & drop the folder to [app.netlify.com/drop](https://app.netlify.com/drop)
- **Vercel:** \`npx vercel --prod\`
- **GitHub Pages:** Push to a repo and enable Pages in Settings
`);
  zip.file(p(".gitignore"), "node_modules/\n.DS_Store\n");
}

function reactPageComponentPath(slug: string): string {
  return `src/pages/${slugToComponentName(slug)}.jsx`;
}

function nextPagesFileRel(slug: string): string {
  if (slug === "/") return "pages/index.js";
  return `pages/${slug.replace(/^\//, "")}.js`;
}

function listPublicImages(jobDir: string): string[] {
  const dir = path.join(jobDir, "images");
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const child = path.join(d, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(child, r);
      else out.push(`public/images/${r}`.replace(/\\/g, "/"));
    }
  };
  walk(dir, "");
  return out.sort();
}

function listPublicScripts(jobDir: string): string[] {
  const dir = path.join(jobDir, "scripts");
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const child = path.join(d, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(child, r);
      else out.push(`public/scripts/${r}`.replace(/\\/g, "/"));
    }
  };
  walk(dir, "");
  return out.sort();
}

// ─── React + Vite builder ───────────────────────────────────────────

async function buildReactProject(
  zip: JSZip,
  pages: PageInfo[],
  css: string,
  manifest: any,
  prefix: string,
  headContent: string,
  jobDir: string,
) {
  const extractedAt = new Date().toISOString();
  const p = (f: string) => `${prefix}/${f}`;
  const q: { path: string; content: string }[] = [];
  const add = (rel: string, content: string) => {
    q.push({ path: p(rel), content });
  };

  const sourceUrl = typeof manifest.url === "string" ? manifest.url : "";
  const title = manifest.title || "Extracted Site";
  const googleFontsLinks = extractGoogleFontsLinks(headContent || pages[0]?.html || "");
  const navItems = extractNavItems(pages[0]?.html || "");
  const assetMap = loadAssetMap(jobDir);
  const publicMap = mapToPublicPaths(assetMap);
  const framer = siteUsesFramer(manifest, pages);
  let siteOrigin = "";
  try {
    if (sourceUrl) siteOrigin = new URL(sourceUrl).origin;
  } catch {
    siteOrigin = "";
  }
  const pathnameToSlug = siteOrigin ? buildPathnameToSlugMap(pages, siteOrigin) : new Map<string, string>();
  const internalPageMap = sourceUrl ? buildInternalPageAbsoluteUrlMap(pages, sourceUrl, "spa") : {};

  // Head-only <style> blocks hold CSS vars/keyframes invisible to body dangerouslySetInnerHTML
  const seenHeadStyles = new Set<string>();
  const headStyleChunks: string[] = [];
  for (const page of pages) {
    for (const block of extractHeadStyleBlocks(page.html)) {
      const key = block.slice(0, 120);
      if (!seenHeadStyles.has(key)) { seenHeadStyles.add(key); headStyleChunks.push(block); }
    }
  }
  const headStylesCss = headStyleChunks.length > 0
    ? `\n\n/* ─── <head> style blocks (CSS vars, keyframes, resets) ─── */\n${headStyleChunks.join("\n\n")}`
    : "";

  let cssForZip = rewriteUrlsWithMap(cleanCssForReactNext(css), { ...publicMap, ...internalPageMap });
  if (framer) cssForZip += framerStaticSnapshotCss();
  cssForZip += REACT_NEXT_VIEWPORT_SHELL_CSS;
  cssForZip += headStylesCss;
  cssForZip = normalizeAssetPathsForSpa(cssForZip);

  // External CDN scripts that drive animations (GSAP, AOS, ScrollReveal, etc.)
  const homeHtml = pages[0]?.html || "";
  const externalScripts = extractExternalScriptUrls(homeHtml, siteOrigin);
  const hasAnimationScripts = externalScripts.length > 0;
  const scriptTags = externalScripts
    .map((s) => {
      const extra = s.defer ? " defer" : s.async ? " async" : " defer";
      return `    <script src=${JSON.stringify(s.src)}${extra}></script>`;
    })
    .join("\n");

  const headLinkDesc = parseHeadLinkDescriptors(reactHeadLinkSources(jobDir, homeHtml));

  const detectedDeps = detectNpmDependencies(pages, css, manifest, "react");

  add(
    "package.json",
    JSON.stringify(
      {
        name: "extracted-site",
        version: "1.0.0",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
          format: "prettier --write .",
        },
        dependencies: {
          react: "^18.2.0",
          "react-dom": "^18.2.0",
          "react-router-dom": "^6.22.0",
          ...detectedDeps.dependencies,
        },
        devDependencies: {
          vite: "^5.0.0",
          "@vitejs/plugin-react": "^4.2.0",
          prettier: "^3.0.0",
          ...detectedDeps.devDependencies,
        },
      },
      null,
      2,
    ),
  );

  add(
    "vite.config.js",
    `import path from 'path';\nimport { fileURLToPath } from 'url';\nimport { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));\n\nexport default defineConfig({\n  plugins: [react()],\n  resolve: {\n    alias: {\n      '@': path.resolve(__dirname, './src'),\n    },\n  },\n});\n`,
  );

  const scriptTagsBlock = scriptTags ? `\n${scriptTags}` : "";
  const headLinksOutput = headLinkDesc.length > 0
    ? `${headLinkDesc.map(formatHeadLinkTagForHtml).join("\n")}\n`
    : googleFontsLinks.length > 0
      ? `    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />\n${googleFontsLinks.map((u) => `    <link href=${JSON.stringify(u)} rel="stylesheet" />`).join("\n")}\n`
      : "";
  const headWithScripts = scriptTagsBlock
    ? `${headLinksOutput}${scriptTagsBlock}`
    : headLinksOutput;
  add(
    "index.html",
    `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n${headWithScripts}    <title>${title}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
  );

  add("src/styles/global.css", cssForZip);

  add(
    "src/main.jsx",
    `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { BrowserRouter } from 'react-router-dom';\nimport App from './App.jsx';\nimport './styles/global.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <BrowserRouter>\n      <App />\n    </BrowserRouter>\n  </React.StrictMode>,\n);\n`,
  );

  const routeImports = pages
    .map((pg) => {
      const comp = slugToComponentName(pg.slug);
      return `import ${comp}Page from './pages/${comp}.jsx';`;
    })
    .join("\n");

  const routeElements = pages
    .map((pg) => {
      const comp = slugToComponentName(pg.slug);
      const routePath = pg.slug === "/" ? "/" : pg.slug;
      return `        <Route path="${routePath}" element={<${comp}Page />} />`;
    })
    .join("\n");

  const navLinks =
    navItems.length > 0
      ? navItems
          .map((n) => {
            const to =
              siteOrigin && sourceUrl
                ? navHrefToRouterTarget(n.href, sourceUrl, pathnameToSlug, siteOrigin)
                : null;
            const target = to ?? n.href;
            return `          <Link to={${JSON.stringify(target)}} className="nav-link">${n.label}</Link>`;
          })
          .join("\n")
      : pages
          .filter((pg) => pg.slug !== "/")
          .slice(0, 6)
          .map((pg) => `          <Link to={${JSON.stringify(pg.slug)}} className="nav-link">${pg.title}</Link>`)
          .join("\n");

  const animInitImport = hasAnimationScripts ? `import AnimationInit from './components/AnimationInit.jsx';\n` : "";
  const animInitJsx = hasAnimationScripts ? `      <AnimationInit />\n` : "";
  add(
    "src/App.jsx",
    `import { Routes, Route } from 'react-router-dom';\n${animInitImport}${routeImports}\nimport NotFoundPage from './pages/NotFound.jsx';\n\nexport default function App() {\n  return (\n    <div className="app">\n${animInitJsx}      <Routes>\n${routeElements}\n        <Route path="*" element={<NotFoundPage />} />\n      </Routes>\n    </div>\n  );\n}\n`,
  );

  if (hasAnimationScripts) {
    add("src/components/AnimationInit.jsx", buildAnimationInitComponent());
  }

  add(
    "src/pages/NotFound.jsx",
    `import { Link } from 'react-router-dom';\n\nexport default function NotFoundPage() {\n  return (\n    <div style={{ minHeight: '50vh', textAlign: 'center', padding: '3rem 1rem' }}>\n      <h1>404</h1>\n      <p>Page not found.</p>\n      <Link to="/">Go home</Link>\n    </div>\n  );\n}\n`,
  );

  // Build page components — deterministic HTML → JSX conversion. Every section
  // becomes a real component file with the markup inline (no AI, no HTML blobs).
  add("src/lib/useInternalNavigation.js", USE_INTERNAL_NAVIGATION_REACT);

  const prepareReactBody = (page: PageInfo): string => {
    let body = rewriteUrlsWithMap(page.bodyContent, publicMap);
    if (siteOrigin && sourceUrl) {
      body = replaceHrefAndActionInHtml(body, page.pageUrl, pathnameToSlug, siteOrigin, "spa");
    }
    body = normalizeAssetPathsForSpa(body);
    body = rewriteUrlsWithMap(body, localPageLinkMap(pages, "spa"));
    if (framer) body = stripFramerModulePreloads(body);
    return body;
  };

  const architecture = generateComponentArchitecture(
    pages,
    prepareReactBody,
    "src/components",
    () => "../components",
  );

  for (const [rel, source] of architecture.componentFiles) {
    add(rel, source);
  }

  for (const page of pages) {
    const comp = slugToComponentName(page.slug);
    const body = architecture.pageBodies.get(page.slug);
    if (!body) continue;
    add(
      `src/pages/${comp}.jsx`,
      `import useInternalNavigation from '../lib/useInternalNavigation.js';
${body.imports.join("\n")}

export default function ${comp}Page() {
  useInternalNavigation();

  return (
    <>
${body.jsx.replace(/\s+$/, "")}
    </>
  );
}
`,
    );
  }

  const pageListReact = pages
    .map((pg) => `  - [\`${pg.slug}\`](${reactPageComponentPath(pg.slug)}): ${pg.title}`)
    .join("\n");
  const platformNoteReact = manifest.platform?.name
    ? `\n> **Note:** This site was originally built with **${manifest.platform.name}**.${manifest.platform.watermarksRemoved ? " Platform watermarks have been removed." : ""}\n`
    : "";
  const framerNoteReact = framer
    ? `\n> **Framer Site:** Framer computes animations via JS at runtime. This static export forces visible text via CSS. For animated clone, use the Full Preview or add framer-motion manually.\n`
    : "";

  const depNotesSectionReact = detectedDeps.notes.length > 0
    ? `\n## Detected Libraries\n\n${detectedDeps.notes.map((n) => `- ${n}`).join("\n")}\n`
    : "";

  add(
    "README.md",
    `# ${title}

React + Vite + React Router project extracted from [${manifest.url}](${manifest.url}) on ${new Date(manifest.createdAt || Date.now()).toLocaleDateString()}.
${platformNoteReact}${framerNoteReact}${depNotesSectionReact}
## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer
- npm, yarn, or pnpm

## Quick Start

\`\`\`bash
npm install
npm run dev
# → http://localhost:5173
\`\`\`

## Pages & routing (${pages.length})

${pageListReact}

## Project structure

- \`src/pages/\` — one component per page, composing its sections
- \`src/components/shared/\` — sections repeated across pages (header, footer)
- \`src/components/<page>/\` — sections unique to a page
- \`src/styles/global.css\` — extracted site CSS, imported once from \`src/main.jsx\`
`,
  );

  add(".gitignore", "node_modules/\ndist/\n.DS_Store\n.env\n");
  add(".prettierrc", PRETTIER_RC);
  add(".prettierignore", "node_modules/\ndist/\npublic/\n");

  appendDirToZip(zip, path.join(jobDir, "images"), `${prefix}/public/images`);
  appendDirToZip(zip, path.join(jobDir, "fonts"), `${prefix}/public/fonts`);
  appendDirToZip(zip, path.join(jobDir, "scripts"), `${prefix}/public/scripts`);
  appendFaviconsToPrefix(zip, jobDir, `${prefix}/public`);

  await formatAndZipTextFiles(zip, q);
}

// ─── Next.js 15 Pages Router builder ───────────────────────────────

async function buildNextProject(
  zip: JSZip,
  pages: PageInfo[],
  css: string,
  manifest: any,
  prefix: string,
  headContent: string,
  jobDir: string,
) {
  const extractedAt = new Date().toISOString();
  const p = (f: string) => `${prefix}/${f}`;
  const q: { path: string; content: string }[] = [];
  const add = (rel: string, content: string) => {
    q.push({ path: p(rel), content });
  };

  const sourceUrl = typeof manifest.url === "string" ? manifest.url : "";
  const title = manifest.title || "Extracted Site";
  const googleFontsLinks = extractGoogleFontsLinks(headContent || pages[0]?.html || "");
  const navItems = extractNavItems(pages[0]?.html || "");
  const assetMap = loadAssetMap(jobDir);
  const publicMap = mapToPublicPaths(assetMap);
  const framer = siteUsesFramer(manifest, pages);
  let siteOriginNext = "";
  try {
    if (sourceUrl) siteOriginNext = new URL(sourceUrl).origin;
  } catch {
    siteOriginNext = "";
  }
  const pathnameToSlugNext = siteOriginNext
    ? buildPathnameToSlugMap(pages, siteOriginNext)
    : new Map<string, string>();
  const internalPageMapNext = sourceUrl ? buildInternalPageAbsoluteUrlMap(pages, sourceUrl, "spa") : {};

  // Head-only <style> blocks hold CSS vars/keyframes invisible to body dangerouslySetInnerHTML
  const seenHeadStylesNext = new Set<string>();
  const headStyleChunksNext: string[] = [];
  for (const page of pages) {
    for (const block of extractHeadStyleBlocks(page.html)) {
      const key = block.slice(0, 120);
      if (!seenHeadStylesNext.has(key)) { seenHeadStylesNext.add(key); headStyleChunksNext.push(block); }
    }
  }
  const headStylesCssNext = headStyleChunksNext.length > 0
    ? `\n\n/* ─── <head> style blocks (CSS vars, keyframes, resets) ─── */\n${headStyleChunksNext.join("\n\n")}`
    : "";

  let cssForZip = rewriteUrlsWithMap(cleanCssForReactNext(css), { ...publicMap, ...internalPageMapNext });
  if (framer) cssForZip += framerStaticSnapshotCss();
  cssForZip += REACT_NEXT_VIEWPORT_SHELL_CSS;
  cssForZip += headStylesCssNext;
  cssForZip = normalizeAssetPathsForSpa(cssForZip);

  // External CDN scripts that drive animations
  const homeHtmlNext = pages[0]?.html || "";
  const externalScriptsNext = extractExternalScriptUrls(homeHtmlNext, siteOriginNext);
  const hasAnimationScriptsNext = externalScriptsNext.length > 0;

  const headLinkDesc = parseHeadLinkDescriptors(reactHeadLinkSources(jobDir, homeHtmlNext));

  const detectedDepsNext = detectNpmDependencies(pages, css, manifest, "nextjs");

  add(
    "package.json",
    JSON.stringify(
      {
        name: "extracted-site",
        version: "1.0.0",
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
          format: "prettier --write .",
        },
        dependencies: {
          next: "^15.0.0",
          react: "^18.2.0",
          "react-dom": "^18.2.0",
          ...detectedDepsNext.dependencies,
        },
        devDependencies: {
          prettier: "^3.0.0",
          ...detectedDepsNext.devDependencies,
        },
      },
      null,
      2,
    ),
  );

  const remoteHostnames = extractImageRemoteHostnames(assetMap);
  const remotePatternsCode = remoteHostnames.length > 0
    ? `  images: {\n    remotePatterns: [\n${remoteHostnames.map((h) => `      { protocol: 'https', hostname: ${JSON.stringify(h)} },`).join("\n")}\n    ],\n  },\n`
    : "";
  add(
    "next.config.mjs",
    `/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n${remotePatternsCode}};\nexport default nextConfig;\n`,
  );

  add("styles/globals.css", `${cssForZip}\n`);

  const headInject = nextHeadLinksJsxLines(headLinkDesc);
  const fontsComment =
    headLinkDesc.length > 0
      ? `/* Extra <head> links injected via <Head> (${headLinkDesc.length} total) */\n`
      : googleFontsLinks.length > 0
        ? `/* Google Fonts: ${googleFontsLinks.join(", ")} */\n`
        : "";

  const animInitImportNext = hasAnimationScriptsNext ? `import AnimationInit from '../components/AnimationInit.jsx';\n` : "";
  const animInitJsxNext = hasAnimationScriptsNext ? `      <AnimationInit />\n` : "";
  add(
    "pages/_app.js",
    `${fontsComment}import '../styles/globals.css';\nimport Head from 'next/head';\n${animInitImportNext}\nexport default function App({ Component, pageProps }) {\n  return (\n    <>\n      <Head>\n${headInject || "        {/* no extra head links */}"}\n      </Head>\n${animInitJsxNext}      <Component {...pageProps} />\n    </>\n  );\n}\n`,
  );

  if (hasAnimationScriptsNext) {
    add("components/AnimationInit.jsx", buildAnimationInitComponent());
  }

  add(
    "pages/404.js",
    `import Head from 'next/head';\nimport Link from 'next/link';\n\nexport default function Custom404() {\n  return (\n    <>\n      <Head>\n        <title>404: Not found</title>\n        <meta name="robots" content="noindex" />\n      </Head>\n      <div style={{ minHeight: '50vh', textAlign: 'center', padding: '3rem 1rem' }}>\n        <h1>404</h1>\n        <p>Page not found.</p>\n        <Link href="/">Go home</Link>\n      </div>\n    </>\n  );\n}\n`,
  );

  // _document.js — inject external CDN animation/library scripts globally
  if (externalScriptsNext.length > 0) {
    const docScriptTags = externalScriptsNext
      .map((s) => {
        const extra = s.defer ? " defer" : s.async ? " async" : " defer";
        return `        <script src=${JSON.stringify(s.src)}${extra} />`;
      })
      .join("\n");
    add(
      "pages/_document.js",
      `import { Html, Head, Main, NextScript } from 'next/document';\n\nexport default function Document() {\n  return (\n    <Html lang="en">\n      <Head />\n      <body>\n        <Main />\n        <NextScript />\n        {/* External scripts from original site (animation libs: GSAP, AOS, etc.) */}\n${docScriptTags}\n      </body>\n    </Html>\n  );\n}\n`,
    );
  }

  // Build page components — deterministic HTML → JSX conversion. Every section
  // becomes a real component file with the markup inline (no AI, no HTML blobs).
  add("components/useInternalNavigation.js", USE_INTERNAL_NAVIGATION_NEXT);

  const prepareNextBody = (page: PageInfo): string => {
    let body = rewriteUrlsWithMap(page.bodyContent, publicMap);
    if (siteOriginNext && sourceUrl) {
      body = replaceHrefAndActionInHtml(body, page.pageUrl, pathnameToSlugNext, siteOriginNext, "spa");
    }
    body = normalizeAssetPathsForSpa(body);
    body = rewriteUrlsWithMap(body, localPageLinkMap(pages, "spa"));
    if (framer) body = stripFramerModulePreloads(body);
    return body;
  };

  // pages/foo/bar.js needs ../../components; pages/foo.js needs ../components
  const importPrefixForNext = (page: PageInfo): string => {
    const rel = nextPagesFileRel(page.slug);
    const depth = rel.split("/").length - 1; // segments below project root
    return `${"../".repeat(depth)}components`.replace(/\/$/, "");
  };

  const architectureNext = generateComponentArchitecture(
    pages,
    prepareNextBody,
    "components",
    importPrefixForNext,
  );

  for (const [rel, source] of architectureNext.componentFiles) {
    add(rel, source);
  }

  for (const page of pages) {
    const comp = slugToComponentName(page.slug);
    const rel = nextPagesFileRel(page.slug);
    const depth = rel.split("/").length - 1;
    const navImport = `${"../".repeat(depth)}components/useInternalNavigation.js`;
    const pageTitleLit = JSON.stringify(page.title || extractTitle(page.html) || title);
    const pageDescLit = JSON.stringify(extractMetaDescription(page.html));
    const body = architectureNext.pageBodies.get(page.slug);
    if (!body) continue;
    add(
      rel,
      `import Head from 'next/head';
import useInternalNavigation from '${navImport}';
${body.imports.join("\n")}

const pageTitle = ${pageTitleLit};
const pageDescription = ${pageDescLit};

export default function ${comp}Page() {
  useInternalNavigation();

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
      </Head>
${body.jsx.replace(/\s+$/, "")}
    </>
  );
}
`,
    );
  }

  const pageListNext = pages
    .map((pg) => `  - [\`${pg.slug}\`](${nextPagesFileRel(pg.slug)}): ${pg.title}`)
    .join("\n");
  const platformNoteNext = manifest.platform?.name
    ? `\n> **Note:** This site was originally built with **${manifest.platform.name}**.${manifest.platform.watermarksRemoved ? " Platform watermarks have been removed." : ""}\n`
    : "";

  const depNotesSectionNext = detectedDepsNext.notes.length > 0
    ? `\n## Detected Libraries\n\n${detectedDepsNext.notes.map((n) => `- ${n}`).join("\n")}\n`
    : "";

  add(
    "README.md",
    `# ${title}

Next.js 15 (Pages Router) project extracted from [${manifest.url}](${manifest.url}) on ${new Date(manifest.createdAt || Date.now()).toLocaleDateString()}.
${platformNoteNext}${depNotesSectionNext}
## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

## Pages (${pages.length})

${pageListNext}

## Project structure

- \`pages/\` — one component per page (Pages Router, no \`app/\` directory)
- \`components/shared/\` — sections repeated across pages (header, footer)
- \`components/<page>/\` — sections unique to a page
- \`styles/globals.css\` — extracted site CSS, imported once from \`pages/_app.js\`
`,
  );

  add(".gitignore", "node_modules/\n.next/\n.DS_Store\n.env.local\n");
  add(".prettierrc", PRETTIER_RC);
  add(".prettierignore", "node_modules/\n.next/\npublic/\n");
  add("public/robots.txt", "User-agent: *\nAllow: /\n");

  appendDirToZip(zip, path.join(jobDir, "images"), `${prefix}/public/images`);
  appendDirToZip(zip, path.join(jobDir, "fonts"), `${prefix}/public/fonts`);
  appendDirToZip(zip, path.join(jobDir, "scripts"), `${prefix}/public/scripts`);
  appendFaviconsToPrefix(zip, jobDir, `${prefix}/public`);

  await formatAndZipTextFiles(zip, q);
}

// ─── Handler ────────────────────────────────────────────────────────

async function appendAiEnhancementsToZip(
  zip: JSZip,
  prefix: string,
  jobId: string,
  framework: "vanilla" | "react" | "nextjs",
) {
  const pack = await generateAiStarterPack({
    id: jobId,
    framework,
  });

  for (const file of pack.files) {
    zip.file(
      `${prefix}/ai-enhancements/${file.path}`,
      await formatAiStarterFile(file.content, file.path),
    );
  }

  zip.file(
    `${prefix}/ai-enhancements/AI_ENHANCEMENTS.md`,
    [
      "# AI Enhancements",
      "",
      `Framework: ${framework}`,
      `Provider: ${pack.provider}`,
      `Model: ${pack.model}`,
      "",
      pack.summary,
      "",
      "## Files",
      ...pack.files.map((file) => `- \`${file.path}\`${file.purpose ? `: ${file.purpose}` : ""}`),
    ].join("\n"),
  );

  zip.file(
    `${prefix}/metadata/ai-enhancements.json`,
    JSON.stringify(
      {
        provider: pack.provider,
        model: pack.model,
        tried: pack.tried,
        summary: pack.summary,
        files: pack.files.map((file) => ({
          path: `ai-enhancements/${file.path}`,
          purpose: file.purpose,
        })),
      },
      null,
      2,
    ),
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id, framework, ai } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Job ID required" });

  const jobDir = path.join(JOBS_DIR, id);
  const manifestPath = path.join(jobDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: "Job not found" });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const fwParam = (typeof framework === "string" ? framework : "vanilla").toLowerCase();
  const pages = loadPages(jobDir, manifest, fwParam === "react" || fwParam === "nextjs" ? "pages-rendered" : "pages");
  const css = gatherBundleCss(jobDir, pages);
  const headContent = loadHeadContent(jobDir);

  const fw = (typeof framework === "string" ? framework : "vanilla").toLowerCase();
  const aiEnhanced = ai === "1" || ai === "true";
  const projectName = safeFileName(manifest.title || "extracted-site");
  const prefix = `${projectName}-${fw}${aiEnhanced ? "-ai" : ""}`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${prefix}.zip"`);

  const zip = new JSZip();

  try {
    switch (fw) {
      case "react":
        await buildReactProject(zip, pages, css, manifest, prefix, headContent, jobDir);
        break;
      case "nextjs":
        await buildNextProject(zip, pages, css, manifest, prefix, headContent, jobDir);
        break;
      default:
        buildVanillaProject(zip, pages, css, manifest, prefix, jobDir);
        break;
    }

    if (aiEnhanced && (fw === "vanilla" || fw === "react" || fw === "nextjs")) {
      await appendAiEnhancementsToZip(zip, prefix, id, fw);
    }

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    res.status(200).send(Buffer.from(buffer));
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}
