import { createHash } from "crypto";
import { chromium, type Browser } from "playwright";

const NAV_TIMEOUT_MS = 45_000;
const NETWORK_IDLE_MS = 20_000;
const MAX_CAPTURED_ASSET_URLS = 1500;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Playwright-backed HTML fetch for JS-rendered sites.
 * Disabled on Vercel (no Chromium, short timeouts). Use a Node worker (Railway, VPS, Docker) with PLAYWRIGHT_SCRAPE=true.
 */
export function playwrightScrapeEnabled(): boolean {
  if (process.env.VERCEL) return false;
  const v = process.env.PLAYWRIGHT_SCRAPE;
  return v === "1" || v?.toLowerCase() === "true";
}

export type PageFetchResult = {
  /** Raw SSR document - what the Framer runtime hydrates against. */
  html: string | null;
  /** Post-JS DOM in initial scroll state - icons/lazy content materialized. */
  renderedHtml: string | null;
  /** Assets observed during navigation with their types. */
  networkAssets: { url: string; type: string }[];
};

export type PlaywrightPageFetcher = {
  fetchPage: (url: string) => Promise<PageFetchResult>;
  dispose: () => Promise<void>;
};

// Resource types to capture during Playwright page load.
// "document" = page navigations (skip). "xhr"/"fetch" = API calls (skip).
// We want stylesheet, script, image, font, media - from ANY domain (Framer CDN is cross-origin).
const CAPTURE_RESOURCE_TYPES = new Set([
  "stylesheet",
  "script",
  "image",
  "font",
  "media",
]);

export async function createPlaywrightPageFetcher(): Promise<PlaywrightPageFetcher | null> {
  if (!playwrightScrapeEnabled()) return null;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  } catch {
    return null;
  }

  const fetchPage = async (url: string): Promise<PageFetchResult> => {
    const networkAssets: { url: string; type: string }[] = [];

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      javaScriptEnabled: true,
    });
    const page = await context.newPage();

    const onFinished = (request: {
      url: () => string;
      resourceType: () => string;
    }) => {
      if (networkAssets.length >= MAX_CAPTURED_ASSET_URLS) return;
      try {
        const u = request.url().split("#")[0];
        if (!u || u.startsWith("data:") || u.startsWith("blob:")) return;
        const rt = request.resourceType();
        if (!CAPTURE_RESOURCE_TYPES.has(rt)) return;
        if (networkAssets.some((a) => a.url === u)) return;
        networkAssets.push({ url: u, type: rt });
      } catch {
        /* ignore */
      }
    };

    page.on("requestfinished", onFinished);

    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      // Raw SSR document - the Framer runtime hydrates against exactly this
      // markup, so saving it (not the post-hydration DOM) avoids React #418.
      let rawHtml: string | null = null;
      try {
        const t = await response?.text();
        if (t && t.includes("<body")) rawHtml = t;
      } catch {
        /* fall back to rendered content */
      }

      // Auto-scroll to trigger lazy loading
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight || totalHeight > 10000) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });

      await page
        .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS })
        .catch(() => {});
      // Wait a bit more for any final Framer hydration
      await new Promise((r) => setTimeout(r, 2000));

      // Rendered DOM in initial scroll state (for static JSX exports)
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise((r) => setTimeout(r, 1000));
      const rendered = await page.content();
      const renderedHtml =
        rendered && rendered.includes("<body") ? rendered : null;

      const html = rawHtml ?? renderedHtml;
      return { html, renderedHtml, networkAssets };
    } catch (err) {
      return { html: null, renderedHtml: null, networkAssets: [] };
    } finally {
      await page.close();
      await context.close();
    }
  };

  const dispose = async () => {
    await browser.close().catch(() => {});
  };

  return { fetchPage, dispose };
}

/** Stable short id for disambiguating duplicate basenames in mirrored script files. */
export function shortUrlHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 8);
}
