import Link from "next/link";
import { useRouter } from "next/router";
import { cn } from "@/lib/utils";
import { GithubIcon } from "@/components/github-icon";
import { GITHUB_URL } from "@/lib/site-config";

/** Sticky top nav on the dark canvas - wordmark left, links center, pill pair right. */
export function MarketingNav({ dark: _dark = true }: { dark?: boolean }) {
  const router = useRouter();

  const navLinks = [
    { href: "/#formats", label: "Formats" },
    { href: "/#how", label: "How it works" },
    { href: "/extract", label: "Extractor" },
  ];

  return (
    <header
      className="sticky top-0 z-40"
      style={{ background: "rgba(11,10,9,0.86)", backdropFilter: "blur(12px)" }}
    >
      <div
        className="mx-auto flex items-center"
        style={{ maxWidth: 1199, height: 56, padding: "0 20px" }}
      >
        <Link
          href="/"
          className="text-white"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 17,
            letterSpacing: "-0.5px",
          }}
        >
          SiteForge
        </Link>

        <nav className="mx-auto hidden items-center gap-7 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-white",
                router.asPath === l.href ? "text-white" : "text-[#999999]",
              )}
              style={{ letterSpacing: "-0.14px" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            className="hidden items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 sm:flex"
            style={{ width: 38, height: 38, background: "var(--ds-surface-1)" }}
          >
            <GithubIcon size={16} />
          </a>
          <Link
            href="/extract"
            className="hidden items-center rounded-full text-sm font-medium text-white transition-opacity hover:opacity-90 sm:inline-flex"
            style={{
              background: "var(--ds-surface-1)",
              padding: "10px 15px",
              letterSpacing: "-0.14px",
              lineHeight: 1,
            }}
          >
            Open extractor
          </Link>
          <Link
            href="/clone"
            className="inline-flex items-center rounded-full text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              background: "#fff",
              color: "#111",
              padding: "10px 15px",
              letterSpacing: "-0.14px",
              lineHeight: 1,
            }}
          >
            Clone a site
          </Link>
        </div>
      </div>
    </header>
  );
}
