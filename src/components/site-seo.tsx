import Head from "next/head";
import { useRouter } from "next/router";
import { SITE_DESCRIPTION, SITE_NAME, getSiteOrigin } from "@/lib/site-config";

type SiteSeoProps = {
  title: string;
  description?: string;
  /** Path including leading slash; query/hash omitted for canonical. */
  canonicalPath?: string;
  noindex?: boolean;
};

export function SiteSeo({ title, description = SITE_DESCRIPTION, canonicalPath, noindex }: SiteSeoProps) {
  const router = useRouter();
  const origin = getSiteOrigin();
  const path =
    canonicalPath ??
    ((typeof router.asPath === "string" ? router.asPath.split("#")[0]?.split("?")[0] : null) || "/");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const canonical = origin ? `${origin}${normalizedPath}` : "";
  const pageTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return (
    <Head>
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      {canonical ? <link rel="canonical" href={canonical} /> : null}
      <meta
        name="robots"
        content={noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"}
      />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content="website" />
      {canonical ? <meta property="og:url" content={canonical} /> : null}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
    </Head>
  );
}
