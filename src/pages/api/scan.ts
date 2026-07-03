import type { NextApiRequest, NextApiResponse } from "next";
import { detectPlatform } from "@/lib/platform-detect";

const TIMEOUT = 10000;

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

async function probeFetch(
  url: string,
): Promise<{ ok: boolean; status: number; headers: Headers; body: string; elapsed: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const start = Date.now();
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    const body = await r.text();
    return { ok: r.ok, status: r.status, headers: r.headers, body, elapsed: Date.now() - start };
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, headers: new Headers(), body: "", elapsed: Date.now() - start };
  }
}

function countInternalLinks(html: string, hostname: string): number {
  let count = 0;
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    const href = m[1]?.trim();
    if (!href) continue;
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:"))
      continue;
    try {
      const u = new URL(href, `https://${hostname}`);
      if (u.hostname === hostname) count++;
    } catch {
      if (href.startsWith("/") || (!href.startsWith("http") && !href.startsWith("//"))) count++;
    }
  }
  return count;
}

function hasMetaNoIndex(html: string): boolean {
  return /<meta[^>]*content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["']/i.test(html)
    || /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
}

function hasCspBlockingIframe(headers: Headers): boolean {
  const csp = headers.get("content-security-policy") || "";
  const xfo = headers.get("x-frame-options") || "";
  if (xfo.toLowerCase().includes("deny") || xfo.toLowerCase().includes("sameorigin")) return true;
  if (csp.includes("frame-ancestors") && !csp.includes("frame-ancestors *")) return true;
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body;
  if (!url || typeof url !== "string")
    return res.status(400).json({ error: "URL is required" });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  const checks: ScanCheck[] = [];

  // ── 1. Reachability ──
  const probe = await probeFetch(parsedUrl.toString());

  if (!probe.ok) {
    checks.push({
      id: "reachable",
      label: "Site reachable",
      status: "fail",
      detail:
        probe.status === 0
          ? "Connection timed out or DNS resolution failed"
          : `Server returned HTTP ${probe.status}`,
    });

    return res.status(200).json({
      url: parsedUrl.toString(),
      reachable: false,
      checks,
      score: 0,
      pageTitle: "",
      estimatedPages: 0,
      recommendation: "risky",
      platform: { name: null, watermarkCount: 0 },
    } satisfies ScanResult);
  }

  checks.push({
    id: "reachable",
    label: "Site reachable",
    status: "pass",
    detail: `Responded in ${probe.elapsed}ms with HTTP ${probe.status}`,
  });

  const html = probe.body;

  // ── 2. HTTPS ──
  checks.push({
    id: "https",
    label: "HTTPS enabled",
    status: parsedUrl.protocol === "https:" ? "pass" : "warn",
    detail:
      parsedUrl.protocol === "https:"
        ? "Site uses secure HTTPS connection"
        : "Site uses HTTP: some assets may not load correctly",
  });

  // ── 3. Content type ──
  const ct = probe.headers.get("content-type") || "";
  const isHtml = ct.includes("text/html") || ct.includes("application/xhtml");
  checks.push({
    id: "content-type",
    label: "HTML content",
    status: isHtml ? "pass" : "warn",
    detail: isHtml
      ? "Server returned valid HTML content"
      : `Content-Type is "${ct}": extraction may be limited`,
  });

  // ── 4. Has <body> ──
  const hasBody = /<body[\s>]/i.test(html);
  checks.push({
    id: "body-tag",
    label: "Valid page structure",
    status: hasBody ? "pass" : "warn",
    detail: hasBody
      ? "Page has a proper HTML body"
      : "No <body> tag found: this may be a SPA or API endpoint",
  });

  // ── 5. JavaScript rendering ──
  const isSpaProbable =
    (html.includes("__NEXT_DATA__") ||
      html.includes("__NUXT__") ||
      html.includes("react-root") ||
      html.includes('id="app"') ||
      html.includes('id="root"')) &&
    html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "").trim().length < 500;
  checks.push({
    id: "js-render",
    label: "Server-rendered content",
    status: isSpaProbable ? "warn" : "pass",
    detail: isSpaProbable
      ? "Page appears to rely heavily on JavaScript for rendering: extracted content may be incomplete"
      : "Page has server-rendered HTML content available for extraction",
  });

  // ── 6. Estimated page count ──
  const internalLinks = countInternalLinks(html, parsedUrl.hostname);
  const estimatedPages = Math.min(Math.max(internalLinks, 1), 20);
  checks.push({
    id: "pages",
    label: "Crawlable pages",
    status: internalLinks > 0 ? "pass" : "warn",
    detail:
      internalLinks > 0
        ? `Found ~${internalLinks} internal links (will crawl up to 20 pages)`
        : "No internal links detected: only the homepage will be extracted",
  });

  // ── 7. CSS availability ──
  const externalCss = (html.match(/<link[^>]*rel=["']stylesheet["']/gi) || []).length;
  const inlineCss = (html.match(/<style[\s>]/gi) || []).length;
  const totalCss = externalCss + inlineCss;
  checks.push({
    id: "css",
    label: "Stylesheets detected",
    status: totalCss > 0 ? "pass" : "warn",
    detail:
      totalCss > 0
        ? `Found ${externalCss} external and ${inlineCss} inline stylesheets: design will be preserved`
        : "No stylesheets detected: the generated project may lack styling",
  });

  // ── 8. Response time ──
  checks.push({
    id: "speed",
    label: "Response speed",
    status: probe.elapsed < 3000 ? "pass" : probe.elapsed < 6000 ? "warn" : "fail",
    detail:
      probe.elapsed < 3000
        ? `Fast response (${probe.elapsed}ms): extraction should be quick`
        : probe.elapsed < 6000
          ? `Moderate response time (${probe.elapsed}ms): extraction may take longer`
          : `Slow response (${probe.elapsed}ms): some pages may time out during crawl`,
  });

  // ── 9. Anti-scraping ──
  const hasCaptcha = /recaptcha|hcaptcha|cf-turnstile|challenge-platform/i.test(html);
  const hasCloudflare = probe.headers.get("cf-ray") != null && html.length < 2000 && /challenge/i.test(html);
  checks.push({
    id: "anti-scrape",
    label: "No anti-bot protection",
    status: hasCaptcha || hasCloudflare ? "warn" : "pass",
    detail:
      hasCaptcha
        ? "CAPTCHA detected: some content may require JavaScript interaction"
        : hasCloudflare
          ? "Cloudflare challenge page detected: extraction may be blocked"
          : "No anti-bot measures detected",
  });

  // ── 10. Frame restrictions ──
  const frameBlocked = hasCspBlockingIframe(probe.headers);
  checks.push({
    id: "frame",
    label: "Preview compatibility",
    status: frameBlocked ? "warn" : "pass",
    detail: frameBlocked
      ? "X-Frame-Options or CSP blocks iframe preview, but extraction and download still work"
      : "No iframe restrictions: live preview will work",
  });

  // ── 11. Meta robots ──
  if (hasMetaNoIndex(html)) {
    checks.push({
      id: "noindex",
      label: "Indexing status",
      status: "warn",
      detail: "Page has noindex: this is a non-public or staging page",
    });
  }

  // ── 12. Framer detection (required) ──
  const platformInfo = detectPlatform(html, parsedUrl.toString());
  if (platformInfo.name === "Framer") {
    checks.push({
      id: "platform",
      label: "Framer site confirmed",
      status: platformInfo.watermarks.length > 0 ? "warn" : "pass",
      detail: platformInfo.watermarks.length > 0
        ? `Framer site detected: ${platformInfo.watermarks.length} watermark${platformInfo.watermarks.length > 1 ? "s" : ""} found (will be removed)`
        : "Framer site detected: no watermarks found",
    });
  } else {
    checks.push({
      id: "platform",
      label: "Framer site required",
      status: "fail",
      detail: platformInfo.name
        ? `This is a ${platformInfo.name} site. Only Framer sites are supported.`
        : "This does not appear to be a Framer site. Only Framer sites are supported.",
    });
  }

  // ── Score ──
  const passCount = checks.filter((c) => c.status === "pass").length;
  const score = Math.round((passCount / checks.length) * 100);

  const failCount = checks.filter((c) => c.status === "fail").length;
  const recommendation: ScanResult["recommendation"] =
    failCount > 0 ? "risky" : score >= 70 ? "ready" : "caution";

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const pageTitle = titleMatch?.[1]?.trim() || parsedUrl.hostname;

  return res.status(200).json({
    url: parsedUrl.toString(),
    reachable: true,
    checks,
    score,
    pageTitle,
    estimatedPages,
    recommendation,
    platform: { name: platformInfo.name, watermarkCount: platformInfo.watermarks.length },
  } satisfies ScanResult);
}
