import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { detectPlatform, stripWatermarks } from "@/lib/platform-detect";
import {
  createPlaywrightPageFetcher,
  playwrightScrapeEnabled,
  shortUrlHash,
} from "@/lib/playwright-page-fetch";

const JOBS_DIR = path.join(process.cwd(), ".extractions");
const MAX_PAGES = 50;
const FETCH_TIMEOUT = 12000;
const MAX_IMAGE_DOWNLOADS = 300;
const MAX_SCRIPT_DOWNLOADS = 200;
const MAX_ASSET_SIZE = 30 * 1024 * 1024;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

async function safeFetch(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,text/css,application/xhtml+xml,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function safeFetchBinary(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const ct = r.headers.get("content-length");
    if (ct && parseInt(ct) > MAX_ASSET_SIZE) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength > MAX_ASSET_SIZE) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function isSpaShell(html: string): boolean {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || "";
  const stripped = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  if (stripped.length < 100) return true;
  const divCount = (body.match(/<div/gi) || []).length;
  const scriptCount = (html.match(/<script/gi) || []).length;
  if (divCount <= 3 && scriptCount >= 3) return true;
  return false;
}

function extractViewportMeta(html: string): string {
  const m =
    html.match(
      /<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*\/?>/i,
    ) ||
    html.match(
      /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']viewport["'][^>]*\/?>/i,
    );
  return m?.[1]?.trim() || "width=device-width, initial-scale=1";
}

function extractFaviconUrl(html: string, pageUrl: string): string | null {
  const m =
    html.match(
      /<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i,
    ) ||
    html.match(
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:icon|shortcut icon)["'][^>]*\/?>/i,
    );
  if (m?.[1]) return resolveUrl(pageUrl, m[1]);
  return resolveUrl(pageUrl, "/favicon.ico");
}

function resolveUrl(base: string, relative: string): string | null {
  try {
    return new URL(relative, base).toString();
  } catch {
    return null;
  }
}

function extractInternalLinks(html: string, baseUrl: URL): string[] {
  const results: string[] = [];
  const matches = html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi);
  for (const m of matches) {
    if (!m[1]) continue;
    const href = m[1].trim();
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    )
      continue;
    const resolved = resolveUrl(baseUrl.toString(), href);
    if (!resolved) continue;
    try {
      const u = new URL(resolved);
      if (u.hostname === baseUrl.hostname) {
        results.push(u.origin + u.pathname);
      }
    } catch {
      /* skip */
    }
  }
  return unique(results);
}

function urlToSlug(pageUrl: string, baseUrl: URL): string {
  try {
    const u = new URL(pageUrl);
    let p = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!p) return "/";
    p = p.replace(/\.html?$/i, "");
    return "/" + p;
  } catch {
    return "/unknown";
  }
}

function extractImages(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(/<img[^>]+srcset=["']([^"']+)["']/gi)) {
    if (m[1])
      for (const e of m[1].split(",")) {
        const u = e.trim().split(/\s+/)[0];
        if (u) results.push(u);
      }
  }
  for (const m of html.matchAll(
    /data-src=["']([^"']+\.(?:png|jpe?g|gif|webp|svg|avif|ico))["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(/<source[^>]+srcset=["']([^"']+)["']/gi)) {
    if (m[1])
      for (const e of m[1].split(",")) {
        const u = e.trim().split(/\s+/)[0];
        if (u) results.push(u);
      }
  }
  for (const m of html.matchAll(
    /background(?:-image)?\s*:[^;]*url\(["']?([^"')]+\.(?:png|jpe?g|gif|webp|svg|avif))["']?\)/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<(?:video|audio|source)[^>]+src=["']([^"']+)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(/<video[^>]+poster=["']([^"']+)["']/gi))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  return unique(results);
}

function extractStylesheetUrls(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /@import\s+(?:url\()?["']([^"']+\.css[^"']*)["']\)?/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  return unique(results);
}

function extractInlineStyles(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)) {
    if (m[1]?.trim().length > 10) results.push(m[1].trim());
  }
  return results;
}

function resolveUrlsInCss(
  css: string,
  cssBaseUrl: string,
  assetMap?: Record<string, string>,
): string {
  return css.replace(
    /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    (match, rawUrl: string) => {
      const u = rawUrl.trim();
      if (u.startsWith("data:")) return match;

      // If we have an asset map and this absolute URL is in it, use the local path.
      if (assetMap && assetMap[u]) return `url("${assetMap[u]}")`;
      const abs = resolveUrl(cssBaseUrl, u);
      if (assetMap && abs && assetMap[abs]) return `url("${assetMap[abs]}")`;

      if (
        u.startsWith("http://") ||
        u.startsWith("https://") ||
        u.startsWith("//")
      )
        return match;
      return abs ? `url("${abs}")` : match;
    },
  );
}

function resolveUrlsInHtml(
  html: string,
  pageUrl: string,
  assetMap?: Record<string, string>,
): string {
  const rewrite = (val: string): string => {
    if (
      !val ||
      val.startsWith("data:") ||
      val.startsWith("#") ||
      val.startsWith("mailto:") ||
      val.startsWith("tel:") ||
      val.startsWith("javascript:")
    )
      return val;

    // Check asset map first
    if (assetMap && assetMap[val]) return assetMap[val];
    const abs = resolveUrl(pageUrl, val);
    if (assetMap && abs && assetMap[abs]) return assetMap[abs];

    if (
      val.startsWith("http://") ||
      val.startsWith("https://") ||
      val.startsWith("//")
    )
      return val;
    return abs || val;
  };

  return html
    .replace(
      /(src|href|poster|data-src|srcset|action)=(["'])([^"']*)\2/gi,
      (match, attr: string, q: string, val: string) => {
        if (attr.toLowerCase() === "srcset") {
          const resolved = val
            .split(",")
            .map((entry) => {
              const parts = entry.trim().split(/\s+/);
              const u = parts[0];
              if (!u) return entry;
              const local = rewrite(u);
              return [local, ...parts.slice(1)].join(" ");
            })
            .join(", ");
          return `${attr}=${q}${resolved}${q}`;
        }
        return `${attr}=${q}${rewrite(val)}${q}`;
      },
    )
    .replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, rawUrl: string) => {
      const u = rawUrl.trim();
      // Fragment refs (SVG clip-path) and data URIs never need rewriting
      if (u.startsWith("#") || u.startsWith("data:")) return match;
      const local = rewrite(u);
      if (local === u) return match;
      // Single quotes: url() often sits inside double-quoted style="" attributes
      return `url('${local}')`;
    });
}

function extractHeadContent(html: string): string {
  const m = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return m?.[1]?.trim() || "";
}

function extractScriptUrls(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi))
    if (m[1]) results.push(m[1]);
  return unique(results);
}

/** ES module graphs (Vite, Next, Framer) often expose chunks only via link modulepreload. */
function extractModulePreloadHrefs(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(
    /<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi,
  )) {
    if (m[1]) results.push(m[1]);
  }
  for (const m of html.matchAll(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']modulepreload["']/gi,
  )) {
    if (m[1]) results.push(m[1]);
  }
  return unique(results);
}

function sortUrlsSameHostFirst(urls: string[], host: string): string[] {
  const same: string[] = [];
  const other: string[] = [];
  for (const u of urls) {
    try {
      if (new URL(u).hostname === host) same.push(u);
      else other.push(u);
    } catch {
      other.push(u);
    }
  }
  return [...same, ...other];
}

function extractInlineScriptCount(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (m[1]?.trim().length > 10 && !m[0].includes(" src=")) n++;
  }
  return n;
}

function extractFonts(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(
    /url\(["']?([^"')]+\.(?:woff2?|ttf|otf|eot)(?:\?[^"')]*)?)["']?\)/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*href=["']([^"']+\.(?:woff2?|ttf|otf|eot)(?:\?[^"']*)?)["'][^>]*as=["']font["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*as=["']font["'][^>]*href=["']([^"']+\.(?:woff2?|ttf|otf|eot)(?:\?[^"']*)?)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  for (const m of html.matchAll(
    /<link[^>]*href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/gi,
  ))
    if (m[1]) results.push(m[1]);
  return unique(results);
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || "";
}

function extractBodyContent(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m?.[1]?.trim() || html;
}

function extractNavItems(
  html: string,
  baseUrl: URL,
): { label: string; href: string }[] {
  const navBlock = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (!navBlock) return [];
  const items: { label: string; href: string }[] = [];
  const links = navBlock[1].matchAll(
    /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  );
  for (const m of links) {
    const href = m[1]?.trim();
    const rawLabel = m[2]?.replace(/<[^>]+>/g, "").trim();
    if (!href || !rawLabel || rawLabel.length > 40) continue;
    items.push({ label: rawLabel, href });
  }
  return items.slice(0, 8);
}

function extractHeadings(html: string): { level: number; text: string }[] {
  const results: { level: number; text: string }[] = [];
  for (const m of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = m[2]?.replace(/<[^>]+>/g, "").trim();
    if (text && text.length < 200)
      results.push({ level: parseInt(m[1]), text });
  }
  return results;
}

function extractMetaDescription(html: string): string {
  const m =
    html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
    ) ||
    html.match(
      /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i,
    );
  return m?.[1]?.trim() || "";
}

interface PageData {
  url: string;
  slug: string;
  title: string;
  description: string;
  html: string;
  bodyContent: string;
  navItems: { label: string; href: string }[];
  headings: { level: number; text: string }[];
  images: string[];
  inlineStyles: string[];
}

export type ExtractProgressEvent = Record<string, unknown>;

export async function runScrapeJob(
  options: { url: string; removeWatermarks?: boolean },
  onProgress?: (event: any) => void,
  jobDirOverride?: string,
) {
  const { url, removeWatermarks } = options;
  const emit = (e: any) => onProgress?.(e);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    throw new Error("Invalid URL");
  }

  const id = jobDirOverride ? path.basename(jobDirOverride) : randomUUID();
  emit({ type: "start", jobId: id, url: parsedUrl.toString() });
  const jobDir = jobDirOverride || path.join(JOBS_DIR, id);
  const pagesDir = path.join(jobDir, "pages");
  const cssDir = path.join(jobDir, "css");
  ensureDir(pagesDir);
  ensureDir(cssDir);

  const pwFetcher = await createPlaywrightPageFetcher();
  const networkAssets: { url: string; type: string }[] = [];

  const fetchPageHtml = async (
    pageUrl: string,
  ): Promise<{ html: string | null; renderedHtml: string | null }> => {
    if (pwFetcher) {
      const result = await pwFetcher.fetchPage(pageUrl);
      for (const a of result.networkAssets) networkAssets.push(a);
      if (result.html)
        return { html: result.html, renderedHtml: result.renderedHtml };
    }
    const html = await safeFetch(pageUrl);
    return { html, renderedHtml: null };
  };

  try {
    const homeFetch = await fetchPageHtml(parsedUrl.toString());
    let homeHtml = homeFetch.html;
    if (!homeHtml) throw new Error("Failed to fetch the page");

    const platformInfo = detectPlatform(homeHtml, parsedUrl.toString());
    if (removeWatermarks && platformInfo.watermarks.length > 0) {
      const result = stripWatermarks(homeHtml);
      homeHtml = result.html;
    }

    const crawled = new Set<string>([parsedUrl.origin + parsedUrl.pathname]);
    const pages: PageData[] = [];
    const allImages: string[] = [];
    const allStylesheetUrls: string[] = [];
    const allScriptUrls: string[] = [];
    const allFonts: string[] = [];
    let totalInlineScripts = 0;
    const allCssContent: string[] = [];

    const pagesRenderedDir = path.join(jobDir, "pages-rendered");
    ensureDir(pagesRenderedDir);

    async function processPage(
      pageUrl: string,
      rawHtml: string,
      renderedHtml?: string | null,
    ) {
      let html = rawHtml;
      if (removeWatermarks && platformInfo.watermarks.length > 0) {
        html = stripWatermarks(html).html;
      }
      const pu = new URL(pageUrl);
      const slug = urlToSlug(pageUrl, parsedUrl);
      const title = extractTitle(html) || pu.pathname;
      const description = extractMetaDescription(html);
      const bodyContent = extractBodyContent(html);
      const navItems = extractNavItems(html, parsedUrl);
      const headings = extractHeadings(html);
      const images = extractImages(html);
      const stylesheetUrls = extractStylesheetUrls(html);
      const scriptUrls = unique([
        ...extractScriptUrls(html),
        ...extractModulePreloadHrefs(html),
      ]);
      const fonts = extractFonts(html);
      const inlineScripts = extractInlineScriptCount(html);
      const inlineStyles = extractInlineStyles(html);

      allImages.push(...images);
      allStylesheetUrls.push(...stylesheetUrls);
      allScriptUrls.push(...scriptUrls);
      allFonts.push(...fonts);
      totalInlineScripts += inlineScripts;

      for (const cssBlock of inlineStyles) {
        allCssContent.push(
          `/* inline style from ${slug} */\n${resolveUrlsInCss(cssBlock, pageUrl)}`,
        );
      }

      const resolvedHtml = resolveUrlsInHtml(html, pageUrl);
      const resolvedBody = extractBodyContent(resolvedHtml);
      const headContent = extractHeadContent(resolvedHtml);

      const safeName =
        slug === "/" ? "index" : slug.replace(/^\//, "").replace(/\//g, "--");
      fs.writeFileSync(path.join(pagesDir, `${safeName}.html`), resolvedHtml);

      // Rendered variant for static JSX exports: icons and lazy content are
      // materialized there, which the raw SSR document lacks.
      if (renderedHtml) {
        let rendered = renderedHtml;
        if (removeWatermarks && platformInfo.watermarks.length > 0) {
          rendered = stripWatermarks(rendered).html;
        }
        fs.writeFileSync(
          path.join(pagesRenderedDir, `${safeName}.html`),
          resolveUrlsInHtml(rendered, pageUrl),
        );
      }

      pages.push({
        url: pageUrl,
        slug,
        title,
        description,
        html: resolvedHtml,
        bodyContent: resolvedBody,
        navItems,
        headings,
        images,
        inlineStyles,
      });
      emit({ type: "page", jobId: id, slug, title, url: pageUrl });

      if (pages.length === 1) {
        fs.writeFileSync(path.join(jobDir, "head-content.html"), headContent);
      }
    }

    await processPage(parsedUrl.toString(), homeHtml, homeFetch.renderedHtml);

    const internalLinks = extractInternalLinks(homeHtml, parsedUrl);
    const toVisit = internalLinks
      .filter((l) => !crawled.has(l))
      .slice(0, MAX_PAGES - 1);

    const crawlBatch = async (urls: string[]) => {
      const promises = urls.map(async (u) => {
        if (crawled.has(u)) return;
        crawled.add(u);
        const { html, renderedHtml } = await fetchPageHtml(u);
        if (html && html.includes("<body")) {
          await processPage(u, html, renderedHtml);
          const subLinks = extractInternalLinks(html, parsedUrl);
          for (const sl of subLinks) {
            if (!crawled.has(sl) && crawled.size < MAX_PAGES) {
              crawled.add(sl);
              const sub = await fetchPageHtml(sl);
              if (sub.html && sub.html.includes("<body")) {
                await processPage(sl, sub.html, sub.renderedHtml);
              }
            }
          }
        }
      });
      await Promise.allSettled(promises);
    };

    await crawlBatch(toVisit);
    emit({ type: "crawl", jobId: id, pagesTotal: pages.length });

    // Supplement with network assets
    for (const a of networkAssets) {
      if (a.type === "image" || a.type === "media") allImages.push(a.url);
      if (a.type === "script") allScriptUrls.push(a.url);
      if (a.type === "font") allFonts.push(a.url);
    }

    const uniqueImages = unique(allImages);
    const uniqueScripts = unique(allScriptUrls);
    const uniqueFonts = unique(allFonts);

    const viewportContent = extractViewportMeta(homeHtml);
    fs.writeFileSync(path.join(jobDir, "viewport.txt"), viewportContent);

    const imagesDir = path.join(jobDir, "images");
    ensureDir(imagesDir);

    const downloadableImages = uniqueImages
      .map((img) => resolveUrl(parsedUrl.toString(), img))
      .filter((u): u is string => u !== null)
      .slice(0, MAX_IMAGE_DOWNLOADS);

    /** Map absolute URL → relative path for offline bundles */
    const downloadBinaryBatch = async (
      urls: string[],
      dir: string,
      relPrefix: "./images/" | "./scripts/" | "./fonts/",
      defaultExt: string,
    ): Promise<Record<string, string>> => {
      const urlToRelative: Record<string, string> = {};
      const usedNames = new Set<string>();
      const chunks = [];
      for (let i = 0; i < urls.length; i += 6)
        chunks.push(urls.slice(i, i + 6));
      let seq = 0;
      for (const chunk of chunks) {
        await Promise.allSettled(
          chunk.map(async (u) => {
            const buf = await safeFetchBinary(u);
            if (!buf) return;
            const parsed = new URL(u);
            let name = path
              .basename(parsed.pathname)
              .replace(/[^a-zA-Z0-9._-]/g, "_");
            if (!name || name === "_")
              name = `asset-${seq++}-${Math.random().toString(36).slice(2, 6)}`;
            // Known extension required - versioned module names like
            // "check.js@0.0.29" must become .js files or esbuild has no loader.
            if (
              !/\.(m?js|css|json|png|jpe?g|gif|webp|svg|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wasm|txt|xml|html)$/i.test(
                name,
              )
            ) {
              name += defaultExt;
            }
            let destName = name;
            if (usedNames.has(destName)) {
              const dot = name.lastIndexOf(".");
              const base = dot > 0 ? name.slice(0, dot) : name;
              const ext = dot > 0 ? name.slice(dot) : defaultExt;
              destName = `${base}-${shortUrlHash(u)}${ext}`;
            }
            usedNames.add(destName);
            const dest = path.join(dir, destName);
            if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
            const rel = `${relPrefix}${destName}`;
            if (!urlToRelative[u]) urlToRelative[u] = rel;
          }),
        );
      }
      return urlToRelative;
    };

    const imageAssetMap = await downloadBinaryBatch(
      downloadableImages,
      imagesDir,
      "./images/",
      ".png",
    );

    const resolvedScriptCandidates = unique(
      uniqueScripts
        .map((s) => resolveUrl(parsedUrl.toString(), s))
        .filter((u): u is string => u !== null),
    );
    const scriptHostOrdered = sortUrlsSameHostFirst(
      resolvedScriptCandidates,
      parsedUrl.hostname,
    ).slice(0, MAX_SCRIPT_DOWNLOADS);

    const scriptsDir = path.join(jobDir, "scripts");
    ensureDir(scriptsDir);
    const scriptAssetMap = await downloadBinaryBatch(
      scriptHostOrdered,
      scriptsDir,
      "./scripts/",
      ".js",
    );

    const fontsDir = path.join(jobDir, "fonts");
    ensureDir(fontsDir);
    const downloadableFonts = uniqueFonts
      .map((f) => resolveUrl(parsedUrl.toString(), f))
      .filter((u): u is string => u !== null);
    const fontAssetMap = await downloadBinaryBatch(
      downloadableFonts,
      fontsDir,
      "./fonts/",
      ".woff2",
    );

    // Map pages to local paths
    const pageAssetMap: Record<string, string> = {};
    for (const p of pages) {
      const safeName =
        p.slug === "/"
          ? "index"
          : p.slug.replace(/^\//, "").replace(/\//g, "--");
      const localPath =
        p.slug === "/" ? "./index.html" : `./pages/${safeName}.html`;
      pageAssetMap[p.url] = localPath;

      // Also map the path without trailing slash if it exists
      if (p.url.endsWith("/")) {
        pageAssetMap[p.url.slice(0, -1)] = localPath;
      } else {
        pageAssetMap[p.url + "/"] = localPath;
      }
    }

    const fullAssetMap = {
      ...imageAssetMap,
      ...scriptAssetMap,
      ...fontAssetMap,
      ...pageAssetMap,
    };
    fs.writeFileSync(
      path.join(jobDir, "asset-map.json"),
      JSON.stringify(fullAssetMap, null, 2),
    );

    // Process CSS now that we have all assets mapped
    const uniqueStylesheetUrls = unique(allStylesheetUrls);
    const inlinedStylesheetUrls: string[] = [];
    const cssFileMap: Record<string, string> = {}; // CDN URL → "style-N.css"
    for (let i = 0; i < uniqueStylesheetUrls.length; i++) {
      const cssUrl = resolveUrl(parsedUrl.toString(), uniqueStylesheetUrls[i]);
      if (!cssUrl) continue;
      const cssText = await safeFetch(cssUrl);
      if (cssText) {
        inlinedStylesheetUrls.push(cssUrl);
        const resolvedCss = resolveUrlsInCss(cssText, cssUrl, fullAssetMap);
        const fname = `style-${i}.css`;
        cssFileMap[cssUrl] = fname;
        fs.writeFileSync(path.join(cssDir, fname), resolvedCss);
        allCssContent.push(`/* ${cssUrl} */\n${resolvedCss}`);
      }
    }
    fs.writeFileSync(
      path.join(jobDir, "css-map.json"),
      JSON.stringify(cssFileMap, null, 2),
    );

    if (platformInfo.name === "Framer") {
      // Editor-bar iframe is Framer tooling - never functional in a clone.
      allCssContent.push(
        `/* website-extractor: hide Framer editor-bar iframe */\n` +
          `#__framer-editorbar { display: none !important; }`,
      );
    }
    if (removeWatermarks && platformInfo.name === "Framer") {
      // The Framer runtime re-injects its badge at hydration; static stripping
      // can't catch that, so hide it via CSS in every export.
      allCssContent.push(
        `/* website-extractor: hide runtime-injected Framer badge */\n` +
          `#__framer-badge-container, .__framer-badge, [data-framer-badge], a[href*="framer.com"][class*="badge"] { display: none !important; }`,
      );
    }

    if (allCssContent.length > 0) {
      fs.writeFileSync(
        path.join(jobDir, "combined.css"),
        allCssContent.join("\n\n"),
      );
    }

    // First write index.html so it can be deep-rewritten
    const spaDetected = isSpaShell(homeHtml);
    fs.writeFileSync(
      path.join(jobDir, "index.html"),
      resolveUrlsInHtml(homeHtml, parsedUrl.toString(), fullAssetMap),
    );

    // Deep rewrite all files to point to local assets
    const deepRewrite = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          deepRewrite(full);
          continue;
        }
        if (
          f.endsWith(".html") ||
          f.endsWith(".css") ||
          f.endsWith(".js") ||
          f.endsWith(".json")
        ) {
          let content = fs.readFileSync(full, "utf8");
          let changed = false;
          // Sort keys by length descending to avoid partial matches
          const sortedKeys = Object.keys(fullAssetMap).sort(
            (a, b) => b.length - a.length,
          );

          // Calculate relative path to root based on file depth
          const relToRoot =
            path.relative(path.dirname(full), jobDir).replace(/\\/g, "/") ||
            ".";
          const prefix = relToRoot === "." ? "./" : relToRoot + "/";

          for (const key of sortedKeys) {
            const localPath = fullAssetMap[key].replace(/^\.\//, prefix);
            const escapedLocalPath = localPath.replace(/\//g, "\\/");

            if (content.includes(key)) {
              const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const regex = new RegExp(escapedKey, "g");
              content = content.replace(regex, localPath);
              changed = true;
            }

            const slashedKey = key.replace(/\//g, "\\/");
            if (content.includes(slashedKey)) {
              const escapedSlashedKey = slashedKey.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );
              const regex = new RegExp(escapedSlashedKey, "g");
              content = content.replace(regex, escapedLocalPath);
              changed = true;
            }
          }

          if (changed) {
            fs.writeFileSync(full, content);
          }
        }
      }
    };

    // Create Portable Bundle for file:// support
    await recursivelyDownloadMissingChunks(
      jobDir,
      fullAssetMap,
      parsedUrl.toString(),
      emit,
    );
    await createPortableBundle(
      jobDir,
      fullAssetMap,
      emit,
      removeWatermarks === true,
    );

    emit({
      type: "progress",
      jobId: id,
      message:
        "Rewriting all asset references (including JS bundle) for offline use...",
    });
    deepRewrite(jobDir);

    // deepRewrite localizes absolute URLs inside JS to relative paths, but
    // single-argument `new URL("../images/x.jpg")` throws. Give them a base.
    // Also neutralize Framer tooling imports (editor bar, badge iframe) that
    // were kept external - an empty data-URL module loads cleanly offline.
    if (fs.existsSync(scriptsDir)) {
      for (const f of fs.readdirSync(scriptsDir)) {
        if (!/\.(js|mjs)$/i.test(f)) continue;
        const full = path.join(scriptsDir, f);
        const content = fs.readFileSync(full, "utf8");
        const patched = content
          .replace(
            /new URL\((["'])(\.\.?\/[^"']*)\1\)/g,
            "new URL($1$2$1, window.location.href)",
          )
          .replace(
            /(["'`])\.\/((?:init|editorbar|preview|EditButton|__framer-badge)[^"'`]*\.mjs)\1/g,
            '"data:text/javascript,"',
          );
        if (patched !== content) fs.writeFileSync(full, patched);
      }
    }

    // 5. Standalone packaging: self-contained HTML copies (CSS + JS inlined) in
    // standalone/. Root index.html and pages/*.html stay clean so the download
    // builders (vanilla/React/Next) and previews keep working asset maps.
    const inlineAssetsIntoHtml = (htmlContent: string): string => {
      let finalHtml = htmlContent;

      // 0. Drop Framer's analytics/tracking script - it reads
      // document.currentScript.src (breaks when inlined) and phones home.
      finalHtml = finalHtml.replace(
        /<script[^>]*\bdata-fid=[^>]*><\/script>/gi,
        "",
      );

      // Drop the editor-bar loader - Framer tooling that navigates to
      // preview-module.html?framerSiteId=… and dead-ends a static clone.
      finalHtml = finalHtml.replace(
        /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi,
        (m, body: string) =>
          body.includes("__framer_force_showing_editorbar_since") ||
          body.includes("editorbar")
            ? ""
            : m,
      );

      // 1. STRIP original module preloads and script modules to avoid CORS errors/conflicts
      finalHtml = finalHtml.replace(
        /<link[^>]+rel=["']modulepreload["'][^>]*>/gi,
        "",
      );
      finalHtml = finalHtml.replace(
        /<link[^>]+href=["'][^"']+["'][^>]*rel=["']modulepreload["'][^>]*>/gi,
        "",
      );
      // Remove all script modules EXCEPT the bundle - attribute order varies
      finalHtml = finalHtml.replace(/<script\b[^>]*><\/script>/gi, (tag) => {
        if (!/type=["']module["']/i.test(tag)) return tag;
        if (tag.includes("portable-bundle.js")) return tag;
        return "";
      });

      // 2. Inline CSS
      if (allCssContent.length > 0) {
        const styleTag = `\n<style>\n${allCssContent.join("\n\n")}\n</style>\n`;
        finalHtml = finalHtml.replace("</head>", () => `${styleTag}</head>`);
        // Remove external CSS links
        finalHtml = finalHtml.replace(
          /<link[^>]*rel=["']stylesheet["'][^>]*href=["'](?:\.\.\/)?css\/style-\d+\.css["'][^>]*>/gi,
          "",
        );
      }

      // 3. Inline JS
      const bundlePath = path.join(jobDir, "scripts", "portable-bundle.js");
      if (fs.existsSync(bundlePath)) {
        const jsContent = fs.readFileSync(bundlePath, "utf8");
        const scriptTag = `\n<script>\n${jsContent}\n</script>\n`;
        // Replace the main bundle reference with inlined code
        const bundleRegex =
          /<script[^>]+src=["'](?:\.\.\/|\.\/)?scripts\/portable-bundle\.js["'][^>]*><\/script>/i;
        if (bundleRegex.test(finalHtml)) {
          finalHtml = finalHtml.replace(bundleRegex, () => scriptTag);
        } else {
          // If the tag was already stripped or missing, inject it at the end of body
          finalHtml = finalHtml.replace("</body>", () => `${scriptTag}</body>`);
        }
      }

      // 4. Framer's client router hijacks internal links and dead-ends on
      // static files. A capture-phase handler registered before the runtime
      // forces real navigation to the local .html pages.
      const navShim = `\n<script>\ndocument.addEventListener('click', function (e) {\n  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;\n  if (!a) return;\n  var href = a.getAttribute('href');\n  if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) return;\n  if (/\\.html(#|$)/i.test(href)) {\n    e.preventDefault();\n    e.stopImmediatePropagation();\n    window.location.href = href;\n  }\n}, true);\n</script>\n`;
      finalHtml = finalHtml.replace(/<head([^>]*)>/i, (m) => `${m}${navShim}`);

      // 5. Inline remaining local classic scripts - scripts/ isn't shipped in
      // the standalone bundle. Missing files: drop the tag instead of 404ing.
      finalHtml = finalHtml.replace(
        /<script([^>]*)src=["'](?:\.\.\/|\.\/)?scripts\/([^"']+)["']([^>]*)><\/script>/gi,
        (tag, pre: string, file: string, post: string) => {
          if (file === "portable-bundle.js") return tag;
          const localPath = path.join(jobDir, "scripts", file);
          if (!fs.existsSync(localPath)) return "";
          if (/type=["']module["']/i.test(pre + post)) return "";
          const js = fs.readFileSync(localPath, "utf8");
          return `\n<script>\n${js}\n</script>\n`;
        },
      );

      return finalHtml;
    };

    emit({
      type: "progress",
      jobId: id,
      message: "Writing self-contained standalone HTML files...",
    });

    // Standalone pages live flat next to index.html, so page-relative prefixes
    // (../images/) and the pages/ subdir vanish from every reference.
    const flattenStandalonePaths = (html: string): string =>
      html
        .replace(/(["'(=])\.\.\/(images|fonts|scripts|css)\//g, "$1./$2/")
        .replace(/(["'(=])\.\.\/index\.html/g, "$1./index.html")
        .replace(/(["'(=])(?:\.\.\/|\.\/)?pages\//g, "$1./");

    const standaloneDir = path.join(jobDir, "standalone");
    ensureDir(standaloneDir);

    const indexFile = path.join(jobDir, "index.html");
    if (fs.existsSync(indexFile)) {
      const content = fs.readFileSync(indexFile, "utf8");
      fs.writeFileSync(
        path.join(standaloneDir, "index.html"),
        flattenStandalonePaths(inlineAssetsIntoHtml(content)),
      );
    }

    if (fs.existsSync(pagesDir)) {
      const pageFiles = fs
        .readdirSync(pagesDir)
        .filter((f) => f.endsWith(".html"));
      for (const pf of pageFiles) {
        if (pf === "index.html") continue; // root index.html already written
        const content = fs.readFileSync(path.join(pagesDir, pf), "utf8");
        fs.writeFileSync(
          path.join(standaloneDir, pf),
          flattenStandalonePaths(inlineAssetsIntoHtml(content)),
        );
      }
    }

    const downloadedImages = Object.keys(imageAssetMap);
    const downloadedScripts = Object.keys(scriptAssetMap);
    const downloadedFonts = Object.keys(fontAssetMap);

    const faviconUrl = extractFaviconUrl(homeHtml, parsedUrl.toString());
    if (faviconUrl) {
      const favBuf = await safeFetchBinary(faviconUrl);
      if (favBuf) {
        const ext = path.extname(new URL(faviconUrl).pathname) || ".ico";
        fs.writeFileSync(path.join(jobDir, `favicon${ext}`), favBuf);
      }
    }

    const manifest = {
      id,
      url: parsedUrl.toString(),
      title: extractTitle(homeHtml) || parsedUrl.hostname,
      description: extractMetaDescription(homeHtml),
      pages: pages.length,
      images: uniqueImages.length,
      stylesheets:
        uniqueStylesheetUrls.length +
        pages.reduce((s, p) => s + p.inlineStyles.length, 0),
      scripts: uniqueScripts.length + totalInlineScripts,
      fonts: uniqueFonts.length,
      crawledPages: pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        url: p.url,
        headingCount: p.headings.length,
        imageCount: p.images.length,
      })),
      navItems: pages[0]?.navItems || [],
      assets: {
        images: uniqueImages,
        stylesheets: uniqueStylesheetUrls,
        scripts: uniqueScripts,
        fonts: uniqueFonts,
      },
      inlinedStylesheetUrls,
      platform: {
        name: platformInfo.name,
        watermarks: platformInfo.watermarks.map((w) => w.description),
        watermarksRemoved: removeWatermarks === true,
      },
      viewport: viewportContent,
      spaDetected,
      renderMode: pwFetcher ? "playwright" : "fetch",
      playwrightConfigured: playwrightScrapeEnabled(),
      downloadedAssets: {
        images: downloadedImages.length,
        scripts: downloadedScripts.length,
        favicon: faviconUrl ? true : false,
      },
      networkAssetsCaptured: networkAssets.length,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(jobDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    const pagesData = pages.map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      navItems: p.navItems,
      headings: p.headings,
      imageCount: p.images.length,
    }));
    fs.writeFileSync(
      path.join(jobDir, "pages-data.json"),
      JSON.stringify(pagesData, null, 2),
    );

    emit({
      type: "done",
      jobId: id,
      id,
      url: parsedUrl.toString(),
      pages: pages.length,
      title: extractTitle(homeHtml) || parsedUrl.hostname,
    });
    return { id, url: parsedUrl.toString() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    emit({ type: "error", jobId: id, message });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    await pwFetcher?.dispose();
  }
}

async function createPortableBundle(
  jobDir: string,
  assetMap: Record<string, string>,
  emit: any,
  stripBadge = false,
) {
  emit({
    type: "progress",
    jobId: path.basename(jobDir),
    message: "Creating portable bundle for offline use...",
  });

  const indexHtmlPath = path.join(jobDir, "index.html");
  if (!fs.existsSync(indexHtmlPath)) return;

  let html = fs.readFileSync(indexHtmlPath, "utf8");

  // Find the entry point script (Framer main bundle)
  const scriptMatch = html.match(
    /<script\s+type=["']module["'][^>]*src=["'](\.\/scripts\/[^"']+)["'][^>]*>/i,
  );
  if (!scriptMatch) return;

  const entryRelPath = scriptMatch[1];
  const entryFullPath = path.join(jobDir, entryRelPath.replace(/^\.\//, ""));

  if (!fs.existsSync(entryFullPath)) {
    emit({
      type: "progress",
      jobId: path.basename(jobDir),
      message: "Entry point not found, skipping bundle.",
    });
    return;
  }

  const bundleDestName = "portable-bundle.js";
  const scriptsDir = path.join(jobDir, "scripts");
  const bundleDestPath = path.join(scriptsDir, bundleDestName);

  // Localize module URLs inside the mirrored scripts BEFORE bundling, so
  // esbuild resolves them on disk and bundles them in (icon modules like
  // Star.js load via dynamic import and would otherwise stay remote).
  const scriptUrlToLocalName: [string, string][] = [];
  for (const [url, local] of Object.entries(assetMap)) {
    const m = local.match(/^\.\/scripts\/(.+)$/);
    if (m) scriptUrlToLocalName.push([url, `./${m[1]}`]);
  }
  scriptUrlToLocalName.sort((a, b) => b[0].length - a[0].length);
  for (const f of fs.readdirSync(scriptsDir)) {
    if (!/\.(m?js)$/i.test(f) || f === bundleDestName) continue;
    const full = path.join(scriptsDir, f);
    let content = fs.readFileSync(full, "utf8");
    let changed = false;
    for (const [url, rel] of scriptUrlToLocalName) {
      if (content.includes(url)) {
        content = content.split(url).join(rel);
        changed = true;
      }
    }
    if (changed) fs.writeFileSync(full, content);
  }

  try {
    // Separate process (arg array, no shell): immune to cmd.exe quoting and to
    // the esbuild service being torn down inside the Next.js dev runtime.
    const { spawnSync } = await import("child_process");
    const esbuildBin = path.join(
      process.cwd(),
      "node_modules",
      "esbuild",
      "bin",
      "esbuild",
    );
    const result = spawnSync(
      process.execPath,
      [
        esbuildBin,
        entryFullPath,
        "--bundle",
        `--outfile=${bundleDestPath}`,
        "--format=iife",
        "--minify",
        "--target=es2020",
        "--platform=browser",
        // import.meta.url is undefined inside an IIFE bundle; point it at the
        // page so runtime `new URL(x, import.meta.url)` calls keep working offline.
        "--define:import.meta.url=window.location.href",
        // Modules we couldn't mirror stay remote instead of failing the build
        "--external:https://*",
        "--external:http://*",
        // Framer tooling never belongs in a static clone: the editor-bar/badge
        // iframe (init.mjs) points at ?framerSiteId=… and dead-ends offline.
        "--external:./editorbar*",
        "--external:./preview*",
        "--external:./init.mjs",
        "--external:./init.*.mjs",
        "--external:./EditButton*",
        ...(stripBadge ? ["--external:./__framer-badge*"] : []),
        "--log-level=error",
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
    );
    if (result.status !== 0) {
      throw new Error(
        `esbuild exited ${result.status}: ${result.stderr?.toString().slice(0, 500)}`,
      );
    }

    if (fs.existsSync(bundleDestPath)) {
      // Update HTML: replace the module script with our classic bundle
      const newScriptTag = `<script src="./scripts/${bundleDestName}"></script>`;
      html = html.replace(scriptMatch[0], newScriptTag);

      // Also remove any modulepreload links to avoid redundant loads or errors on file://
      html = html.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>/gi, "");

      fs.writeFileSync(indexHtmlPath, html);
      emit({
        type: "progress",
        jobId: path.basename(jobDir),
        message: "Portable bundle created! Works offline via file://",
      });
    }
  } catch (err) {
    console.error("Bundling failed:", err);
    emit({
      type: "progress",
      jobId: path.basename(jobDir),
      message: "Bundling failed, using standard modules.",
    });
  }
}

async function recursivelyDownloadMissingChunks(
  jobDir: string,
  assetMap: Record<string, string>,
  baseUrl: string,
  emit: any,
) {
  emit({
    type: "progress",
    jobId: path.basename(jobDir),
    message: "Searching for hidden script chunks...",
  });

  const scriptsDir = path.join(jobDir, "scripts");
  if (!fs.existsSync(scriptsDir)) return;

  let foundNew = true;
  let iterations = 0;
  const MAX_ITERATIONS = 5; // Don't loop forever

  while (foundNew && iterations < MAX_ITERATIONS) {
    foundNew = false;
    iterations++;

    const files = fs
      .readdirSync(scriptsDir)
      .filter((f) => f.endsWith(".mjs") || f.endsWith(".js"));
    const currentAssetUrls = new Set(Object.keys(assetMap));

    for (const file of files) {
      const fullPath = path.join(scriptsDir, file);
      const content = fs.readFileSync(fullPath, "utf8");

      // Dynamic imports (quotes, backticks, escaped quotes), static `from`,
      // and bare side-effect imports.
      const matches = [
        ...content.matchAll(
          /import\(\s*\\?["'`]([^"'`\\)]+\.mjs)\\?["'`]\s*\)/gi,
        ),
        ...content.matchAll(/from\s*\\?["'`]([^"'`\\]+\.mjs)\\?["'`]/gi),
        ...content.matchAll(/\bimport\s*\\?["'`]([^"'`\\]+\.mjs)\\?["'`]/gi),
      ];
      for (const m of matches) {
        const rawUrl = m[1].replace(/\\/g, ""); // Clean up escapes
        let absoluteUrl: string | null = null;

        if (rawUrl.startsWith("http")) {
          absoluteUrl = rawUrl;
        } else if (rawUrl.startsWith("/")) {
          try {
            const baseObj = new URL(baseUrl);
            absoluteUrl = new URL(rawUrl, baseObj.origin).toString();
          } catch {}
        } else {
          // Relative to the current script - find original URL of this file
          const originalUrl = Object.entries(assetMap).find(([u, local]) =>
            local.endsWith(file),
          )?.[0];
          if (originalUrl) {
            absoluteUrl = resolveUrl(originalUrl, rawUrl);
          } else {
            // Fallback to base URL
            absoluteUrl = resolveUrl(baseUrl, rawUrl);
          }
        }

        if (absoluteUrl && !currentAssetUrls.has(absoluteUrl)) {
          const buf = await safeFetchBinary(absoluteUrl);
          if (buf) {
            const name = path.basename(new URL(absoluteUrl).pathname);
            const dest = path.join(scriptsDir, name);
            if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
            assetMap[absoluteUrl] = `./scripts/${name}`;
            currentAssetUrls.add(absoluteUrl);
            foundNew = true;
            emit({
              type: "progress",
              jobId: path.basename(jobDir),
              message: `Found hidden chunk: ${name}`,
            });
          }
        }
      }
    }
  }
}
