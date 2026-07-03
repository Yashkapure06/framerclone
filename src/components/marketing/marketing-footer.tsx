import Link from "next/link";
import { GITHUB_URL } from "@/lib/site-config";
import { GithubIcon } from "@/components/github-icon";

/** Caption-sized footer on the dark canvas. */
export function MarketingFooter({ dark: _dark = true }: { dark?: boolean }) {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--ds-hairline-soft)",
        padding: "64px 32px",
      }}
    >
      <div
        className="mx-auto flex flex-col justify-between gap-8 md:flex-row md:items-start"
        style={{ maxWidth: 1199 }}
      >
        <div>
          <span
            className="text-white"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: "-0.4px",
            }}
          >
            SiteForge
          </span>
          <p
            style={{
              fontSize: 13,
              letterSpacing: "-0.13px",
              color: "var(--ds-ink-muted)",
              marginTop: 8,
              maxWidth: 320,
              lineHeight: 1.4,
            }}
          >
            A focused tool for extracting published Framer sites into code you
            can keep. Clone only what you own.
          </p>
        </div>

        <div className="flex flex-wrap gap-14">
          <div>
            <p
              className="text-white"
              style={{
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.13px",
                marginBottom: 12,
              }}
            >
              Product
            </p>
            {[
              { label: "Clone a site", href: "/clone" },
              { label: "Extractor", href: "/extract" },
            ].map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="block transition-colors hover:text-white"
                style={{
                  fontSize: 13,
                  letterSpacing: "-0.13px",
                  color: "var(--ds-ink-muted)",
                  padding: "5px 0",
                }}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <div>
            <p
              className="text-white"
              style={{
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.13px",
                marginBottom: 12,
              }}
            >
              Open source
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 transition-colors hover:text-white"
              style={{
                fontSize: 13,
                letterSpacing: "-0.13px",
                color: "var(--ds-ink-muted)",
                padding: "5px 0",
              }}
            >
              <GithubIcon size={13} /> GitHub
            </a>
            <a
              href={`${GITHUB_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="block transition-colors hover:text-white"
              style={{
                fontSize: 13,
                letterSpacing: "-0.13px",
                color: "var(--ds-ink-muted)",
                padding: "5px 0",
              }}
            >
              Report an issue
            </a>
          </div>
          <div>
            <p
              className="text-white"
              style={{
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.13px",
                marginBottom: 12,
              }}
            >
              Fair use
            </p>
            <p
              style={{
                fontSize: 13,
                letterSpacing: "-0.13px",
                color: "var(--ds-ink-muted)",
                maxWidth: 220,
                lineHeight: 1.4,
              }}
            >
              Cloning removes badges, not copyright. Respect the original
              author&rsquo;s work.
            </p>
          </div>
        </div>
      </div>
      <p
        className="mx-auto"
        style={{
          maxWidth: 1199,
          fontSize: 12,
          letterSpacing: "-0.12px",
          color: "var(--ds-ink-muted)",
          marginTop: 40,
        }}
      >
        © {new Date().getFullYear()} SiteForge. Not affiliated with Framer B.V.
      </p>
    </footer>
  );
}
