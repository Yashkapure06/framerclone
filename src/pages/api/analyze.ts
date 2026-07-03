import type { NextApiRequest, NextApiResponse } from "next";
import { detectPlatform } from "@/lib/platform-detect";
import { scrapeFramerMarketplace } from "@/lib/framer-marketplace";

const FETCH_TIMEOUT = 12000;

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractTitle(html: string, hostname: string): string {
  return (
    html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ||
    html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ||
    hostname
  );
}

function extractDescription(html: string): string {
  return (
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ||
    ""
  );
}

function extractColors(html: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)) {
    const hex = m[0].toLowerCase();
    if (!seen.has(hex)) {
      seen.add(hex);
      results.push(hex);
    }
    if (results.length >= 8) break;
  }
  return results;
}

const GENERIC_FONTS = new Set([
  "sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy",
  "inherit", "initial", "unset", "revert", "ui-sans-serif", "ui-serif",
  "ui-monospace", "-apple-system", "BlinkMacSystemFont",
]);

function extractFonts(html: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  const add = (raw: string) => {
    const cleaned = raw.replace(/['"]/g, "").trim();
    if (
      cleaned.length < 2 ||
      cleaned.length > 50 ||
      seen.has(cleaned) ||
      cleaned.startsWith("var(") ||
      cleaned.includes("Placeholder") ||
      GENERIC_FONTS.has(cleaned)
    ) return;
    seen.add(cleaned);
    results.push(cleaned);
  };
  for (const m of html.matchAll(/font-family\s*:\s*['"]?([A-Za-z][^'",;)]{1,48})/gi)) {
    add(m[1]);
  }
  for (const m of html.matchAll(/fonts\.googleapis\.com[^"']*family=([^&"']+)/gi)) {
    for (const fam of m[1].split("|")) {
      add(decodeURIComponent(fam.split(":")[0]).replace(/\+/g, " "));
    }
  }
  return results.slice(0, 6);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function dedupLabel(raw: string): string {
  const s = decodeEntities(raw.replace(/\s+/g, " ").trim());
  if (s.length % 2 === 0) {
    const half = s.length / 2;
    if (s.slice(0, half) === s.slice(half)) return s.slice(0, half).trim();
  }
  return s;
}

function extractPageNames(html: string, baseUrl: URL): string[] {
  const seen = new Set<string>(["Home"]);
  const results: string[] = ["Home"];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]?.trim();
    const raw = m[2]?.replace(/<[^>]+>/g, "");
    if (!href || !raw) continue;
    const label = dedupLabel(raw);
    if (!label || label.length > 30) continue;
    try {
      const u = new URL(href, baseUrl);
      if (u.hostname === baseUrl.hostname && u.pathname !== "/" && !seen.has(label)) {
        seen.add(label);
        results.push(label);
      }
    } catch { /* skip */ }
    if (results.length >= 8) break;
  }
  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "URL required" });

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const html = await fetchHtml(parsed.toString());
  if (!html) {
    return res.status(400).json({ error: "Failed to fetch the site. Check the URL and try again." });
  }

  const platform = detectPlatform(html, parsed.toString());
  if (platform.name !== "Framer") {
    return res.status(400).json({
      error: "Not a Framer website. Only Framer sites are supported.",
    });
  }

  const title = extractTitle(html, parsed.hostname);
  const description = extractDescription(html);
  const colors = extractColors(html);
  const fonts = extractFonts(html);
  const pages = extractPageNames(html, parsed);

  let marketplace = null;
  const host = parsed.hostname;
  if (host.endsWith(".framer.website") || host.endsWith(".framer.app")) {
    const slug = host.replace(/\.framer\.(website|app)$/, "");
    if (slug) {
      marketplace = await scrapeFramerMarketplace(slug);
    }
  }

  return res.status(200).json({
    url: parsed.toString(),
    title,
    description,
    isFramer: true,
    pages,
    colors,
    fonts,
    marketplace,
  });
}
