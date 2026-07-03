export interface MarketplaceData {
  found: boolean;
  name?: string;
  description?: string;
  categories?: string[];
  keyFeatures?: string[];
  targetAudience?: string[];
  price?: string;
}

export async function scrapeFramerMarketplace(
  slug: string,
): Promise<MarketplaceData> {
  try {
    const url = `https://www.framer.com/marketplace/templates/${encodeURIComponent(slug)}/`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) return { found: false };
    if (!res.ok) return { found: false };

    const html = await res.text();

    if (!html.toLowerCase().includes(slug.toLowerCase()))
      return { found: false };

    const name =
      html
        .match(
          /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i,
        )?.[1]
        ?.replace(/\s*[|-–-]\s*Framer.*$/i, "")
        .trim() || html.match(/<h1[^>]*>([^<]{2,80})<\/h1>/i)?.[1]?.trim();

    if (!name) return { found: false };

    const description =
      html
        .match(
          /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
        )?.[1]
        ?.trim() ||
      html
        .match(
          /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
        )?.[1]
        ?.trim();

    const priceMatch = html.match(/>\s*\$(\d+(?:\.\d{2})?)\s*</);
    const price = priceMatch ? `$${priceMatch[1]}` : "Free";

    const jsonLd = extractJsonLd(html);

    const categories = extractCategories(html, jsonLd);
    const keyFeatures = extractKeyFeatures(html, jsonLd);
    const targetAudience = extractTargetAudience(html, jsonLd);

    return {
      found: true,
      name,
      description,
      categories,
      keyFeatures,
      targetAudience,
      price,
    };
  } catch {
    return { found: false };
  }
}

function extractJsonLd(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]);
      if (data && typeof data === "object") return data;
    } catch {
      /* skip */
    }
  }
  return null;
}

function extractCategories(
  html: string,
  jsonLd: Record<string, unknown> | null,
): string[] {
  if (jsonLd?.keywords && typeof jsonLd.keywords === "string") {
    return jsonLd.keywords
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
  }
  const tagPattern =
    /class=["'][^"']*(?:tag|category|badge|chip)[^"']*["'][^>]*>([^<]{2,30})</gi;
  const tags = new Set<string>();
  for (const m of html.matchAll(tagPattern)) {
    const t = m[1].trim();
    if (t.length >= 2 && t.length <= 30) tags.add(t);
    if (tags.size >= 5) break;
  }
  return [...tags];
}

function extractKeyFeatures(
  html: string,
  jsonLd: Record<string, unknown> | null,
): string[] {
  const features: string[] = [];
  const featurePattern =
    /(?:key features?|what(?:'s| is) included|includes?)[^<]*<\/[^>]+>([\s\S]{0,800})/gi;
  for (const block of html.matchAll(featurePattern)) {
    const listItems = [...block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    for (const li of listItems) {
      const text = li[1].replace(/<[^>]+>/g, "").trim();
      if (text.length >= 5 && text.length <= 80) features.push(text);
      if (features.length >= 6) break;
    }
    if (features.length >= 6) break;
  }
  return features;
}

function extractTargetAudience(
  html: string,
  jsonLd: Record<string, unknown> | null,
): string[] {
  const audience: string[] = [];
  const audiencePattern =
    /(?:target audience|perfect for|ideal for|designed for|built for)[^<]*<\/[^>]+>([\s\S]{0,500})/gi;
  for (const block of html.matchAll(audiencePattern)) {
    const listItems = [...block[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    for (const li of listItems) {
      const text = li[1].replace(/<[^>]+>/g, "").trim();
      if (text.length >= 3 && text.length <= 50) audience.push(text);
      if (audience.length >= 4) break;
    }
    if (audience.length >= 4) break;
  }
  return audience;
}
