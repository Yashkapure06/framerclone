export interface WatermarkInfo {
  selector: string;
  description: string;
  pattern: RegExp;
}

export interface PlatformResult {
  name: string | null;
  watermarks: WatermarkInfo[];
}

const PLATFORMS: {
  name: string;
  detect: (html: string, url: string) => boolean;
  watermarks: WatermarkInfo[];
}[] = [
  {
    name: "Framer",
    detect: (html) =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*Framer/i.test(html) ||
      /framerusercontent\.com/i.test(html) ||
      /class=["'][^"']*framer-/i.test(html),
    watermarks: [
      { selector: "framer-badge", description: "Framer badge overlay", pattern: /<div[^>]*class=["'][^"']*framer-badge[^"']*["'][^>]*>[\s\S]*?<\/div>/gi },
      { selector: "framer-badge-link", description: "Made in Framer link", pattern: /<a[^>]*href=["'][^"']*framer\.com[^"']*["'][^>]*>[\s\S]*?Made\s+(?:in|with)\s+Framer[\s\S]*?<\/a>/gi },
      { selector: "framer-overlay-script", description: "Framer overlay script", pattern: /<script[^>]*(?:framer-badge|framerBadge|framer-overlay)[^>]*>[\s\S]*?<\/script>/gi },
      { selector: "framer-edit-button", description: "Edit in Framer button", pattern: /<div[^>]*id=["']framer-edit-button["'][^>]*>[\s\S]*?<\/div>/gi },
      { selector: "framer-feedback", description: "Framer feedback bar", pattern: /<div[^>]*class=["'][^"']*framer-feedback[^"']*["'][^>]*>[\s\S]*?<\/div>/gi },
      { selector: "framer-force-editor", description: "Framer editor bar script", pattern: /<script[^>]*>try\{if\(localStorage\.get\("__framer_force_showing_editorbar_since"\)\)[\s\S]*?<\/script>/gi },
    ],
  },
  {
    name: "Webflow",
    detect: (html) =>
      /data-wf-site/i.test(html) ||
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*Webflow/i.test(html),
    watermarks: [
      { selector: "webflow-badge", description: "Webflow badge", pattern: /<a[^>]*class=["'][^"']*w-webflow-badge[^"']*["'][^>]*>[\s\S]*?<\/a>/gi },
      { selector: "made-in-webflow", description: "Made in Webflow link", pattern: /<a[^>]*href=["'][^"']*webflow\.com[^"']*["'][^>]*>[\s\S]*?(?:Made\s+in|Powered\s+by)\s+Webflow[\s\S]*?<\/a>/gi },
    ],
  },
  {
    name: "Wix",
    detect: (html) =>
      /X-Wix-/i.test(html) ||
      /wix-bolt/i.test(html) ||
      /wixsite\.com/i.test(html) ||
      /<meta[^>]*http-equiv=["']X-Wix-/i.test(html),
    watermarks: [
      { selector: "wix-ads", description: "Wix advertisement banner", pattern: /<div[^>]*id=["']WIX_ADS[^"']*["'][^>]*>[\s\S]*?<\/div>/gi },
      { selector: "wix-badge", description: "Wix promotional badge", pattern: /<a[^>]*href=["'][^"']*wix\.com[^"']*["'][^>]*>[\s\S]*?(?:Create|Build|Made)\s+(?:a\s+)?(?:Free\s+)?(?:Website|with)\s*(?:Wix)?[\s\S]*?<\/a>/gi },
    ],
  },
  {
    name: "Squarespace",
    detect: (html) =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*Squarespace/i.test(html) ||
      /squarespace-cdn\.com/i.test(html) ||
      /static1\.squarespace\.com/i.test(html),
    watermarks: [
      { selector: "squarespace-announcement", description: "Squarespace announcement bar", pattern: /<div[^>]*class=["'][^"']*squarespace-announcement-bar[^"']*["'][^>]*>[\s\S]*?<\/div>/gi },
      { selector: "squarespace-badge", description: "Squarespace badge", pattern: /<a[^>]*href=["'][^"']*squarespace\.com[^"']*["'][^>]*>[\s\S]*?(?:Powered\s+by|Built\s+on)\s+Squarespace[\s\S]*?<\/a>/gi },
    ],
  },
  {
    name: "WordPress",
    detect: (html) =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*WordPress/i.test(html) ||
      /wp-content\//i.test(html) ||
      /wp-includes\//i.test(html),
    watermarks: [
      { selector: "wp-admin-bar", description: "WordPress admin bar", pattern: /<div[^>]*id=["']wpadminbar["'][^>]*>[\s\S]*?<\/div>/gi },
    ],
  },
  {
    name: "Carrd",
    detect: (html) =>
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*Carrd/i.test(html) ||
      /carrd\.co/i.test(html),
    watermarks: [
      { selector: "carrd-badge", description: "Carrd attribution badge", pattern: /<a[^>]*href=["'][^"']*carrd\.co[^"']*["'][^>]*>[\s\S]*?<\/a>/gi },
    ],
  },
  {
    name: "Notion",
    detect: (html) =>
      /notion\.so/i.test(html) ||
      /notion-static\.com/i.test(html) ||
      /super\.so/i.test(html),
    watermarks: [
      { selector: "notion-badge", description: "Built with Notion badge", pattern: /<a[^>]*href=["'][^"']*notion\.so[^"']*["'][^>]*>[\s\S]*?(?:Built|Made|Powered)\s+(?:with|by)\s+Notion[\s\S]*?<\/a>/gi },
    ],
  },
  {
    name: "Shopify",
    detect: (html) =>
      /cdn\.shopify\.com/i.test(html) ||
      /Shopify\.theme/i.test(html) ||
      /<meta[^>]*name=["']generator["'][^>]*content=["'][^"']*Shopify/i.test(html),
    watermarks: [
      { selector: "shopify-badge", description: "Powered by Shopify link", pattern: /<a[^>]*href=["'][^"']*shopify\.com[^"']*["'][^>]*>[\s\S]*?(?:Powered\s+by)\s+Shopify[\s\S]*?<\/a>/gi },
    ],
  },
];

export function detectPlatform(html: string, url: string): PlatformResult {
  for (const platform of PLATFORMS) {
    if (platform.detect(html, url)) {
      const activeWatermarks = platform.watermarks.filter((w) => w.pattern.test(html));
      return { name: platform.name, watermarks: activeWatermarks };
    }
  }
  return { name: null, watermarks: [] };
}

const FRAMER_CHECK_TIMEOUT = 10_000;

export async function assertFramerSite(url: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid URL"); }

  // Block framer.com itself — it's Framer's own website.
  // Users should paste the published site's direct URL, e.g. https://mysite.com or https://mysite.framer.website
  const host = parsed.hostname.toLowerCase();
  if (host === "framer.com" || host === "www.framer.com" || host.endsWith(".framer.com")) {
    throw new Error(
      'This is Framer\'s own website, not a published Framer site. ' +
      'Please paste the direct URL of the site you want to clone (e.g. https://yoursite.framer.website or your custom domain).'
    );
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FRAMER_CHECK_TIMEOUT);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Site returned HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Site returned")) throw e;
    throw new Error("Could not reach the site — check the URL and try again");
  }

  const { name } = detectPlatform(html, url);
  if (name !== "Framer") {
    throw new Error(
      name
        ? `This is a ${name} site. Only Framer sites are supported.`
        : "This does not appear to be a Framer site. Only Framer sites are supported.",
    );
  }
}

export function stripWatermarks(html: string): { html: string; removed: number } {
  let result = html;
  let removed = 0;

  for (const platform of PLATFORMS) {
    for (const wm of platform.watermarks) {
      const before = result;
      wm.pattern.lastIndex = 0;
      result = result.replace(wm.pattern, "");
      if (result !== before) removed++;
    }
  }

  return { html: result, removed };
}
