import React, { useState } from "react";
import { useRouter } from "next/router";

import { SiteSeo } from "@/components/site-seo";
import { SITE_DESCRIPTION } from "@/lib/site-config";

type Framework = "vanilla" | "react" | "nextjs";

export default function FullPreviewPage() {
  const router = useRouter();
  const { id, framework, page } = router.query;
  const [loadedSrc, setLoadedSrc] = useState("");

  const fw: Framework =
    typeof framework === "string" && ["vanilla", "react", "nextjs"].includes(framework)
      ? (framework as Framework)
      : "vanilla";

  const activePage = typeof page === "string" ? page : "";

  const src = id
    ? `/api/preview-rendered/${id}?framework=${fw}${activePage ? `&page=${encodeURIComponent(activePage)}` : ""}`
    : "";

  const fullPreviewPath =
    typeof id === "string" ? `/preview-full/${id}` : "/preview-full";
  const ready = !!src && loadedSrc === src;

  return (
    <>
      <SiteSeo title="Full preview" description={SITE_DESCRIPTION} canonicalPath={fullPreviewPath} noindex />
      <style jsx global>{`
        html,
        body,
        #__next {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
        }
      `}</style>

      {!ready && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            gap: 12,
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#999"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: "spin 1s linear infinite" }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span style={{ fontSize: 13, color: "#999" }}>Loading preview&hellip;</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {src && (
        <iframe
          key={src}
          src={src}
          onLoad={() => setLoadedSrc(src)}
          title="Full Preview"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            display: "block",
          }}
        />
      )}
    </>
  );
}

(FullPreviewPage as any).disableShell = true;
