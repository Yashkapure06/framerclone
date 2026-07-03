export const SITE_NAME = "SiteForge";

export const SITE_DESCRIPTION =
  "Paste a Framer website URL and clone the entire site: HTML, CSS, fonts, and assets. Download as a clean zip instantly.";

/** Public repository. Swap in the real URL when the repo goes live. */
export const GITHUB_URL = "https://github.com/Yashkapure06/framerclone";

export function getSiteOrigin(): string {
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.host}`;
  }
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  return env || "";
}
