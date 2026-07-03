import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
} from "framer-motion";
import {
  ArrowRight,
  Menu,
  X,
  FileCode2,
  Atom,
  Layers,
  Star,
} from "lucide-react";
import { GithubIcon } from "@/components/github-icon";
import { GITHUB_URL } from "@/lib/site-config";

/* ── Framer-inspired design tokens ─────────────────────────────────────────
   canvas #0B0A09 · surface-1 #1A1918 · surface-2 #262524
   ink #FFF · ink-muted #999 · accent #0099FF (links/focus only)
   gradient family: violet / magenta / orange / coral (cards + hero aurora)
──────────────────────────────────────────────────────────────────────────── */

const T = {
  canvas: "#0B0A09",
  surface1: "#1A1918",
  surface2: "#262524",
  hairline: "rgba(255,255,255,0.10)",
  hairlineSoft: "rgba(255,255,255,0.06)",
  ink: "#FFFFFF",
  inkMuted: "#999999",
  accent: "#0099FF",
  gradientVioletCard:
    "radial-gradient(130% 140% at 18% 0%, #8B3DFF 0%, #A21EDC 46%, #380D72 100%)",
  gradientOrangeCard:
    "radial-gradient(140% 150% at 82% 8%, #FFB27A 0%, #FF6B2C 48%, #B92E08 100%)",
} as const;

const displayFont = '"Mona Sans", "GT Walsheim", Inter, system-ui, sans-serif';
const bodyFont = "Inter, system-ui, sans-serif";
const bodyFeatures = '"cv01","cv05","cv09","cv11","ss03","ss07","dlig"';

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 120, damping: 20 },
  },
} as const;

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
} as const;

/* ── Pills ── */
function PillPrimary({
  children,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      className="fc-pill inline-flex items-center gap-1.5 shrink-0"
      style={{
        background: T.ink,
        color: "#111",
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "-0.14px",
        padding: "10px 15px",
        borderRadius: 100,
        lineHeight: 1,
      }}
      whileHover={{ y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
    >
      {children}
    </motion.button>
  );
}

function PillSecondary({
  children,
  href,
  onClick,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const style: React.CSSProperties = {
    background: T.surface1,
    color: T.ink,
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: "-0.14px",
    padding: "10px 15px",
    borderRadius: 100,
    lineHeight: 1,
  };
  if (href)
    return (
      <motion.a
        href={href}
        className="fc-pill inline-flex items-center gap-1.5"
        style={style}
        whileHover={{ y: -1, scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 24 }}
      >
        {children}
      </motion.a>
    );
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="fc-pill inline-flex items-center gap-1.5"
      style={style}
      whileHover={{ y: -1, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
    >
      {children}
    </motion.button>
  );
}

/* ── Top nav ── */
function TopNav({ onClone }: { onClone: () => void }) {
  const [open, setOpen] = useState(false);
  const links = [
    { label: "Formats", href: "#formats" },
    { label: "How it works", href: "#how" },
    { label: "FAQ", href: "#faq" },
  ];
  return (
    <motion.header
      className="sticky top-0 z-40"
      style={{
        background: "rgba(11,10,9,0.78)",
        backdropFilter: "blur(14px)",
        borderBottom: `1px solid ${T.hairlineSoft}`,
      }}
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 20, delay: 0.05 }}
    >
      <div
        className="mx-auto flex items-center"
        style={{ maxWidth: 1199, height: 56, padding: "0 20px" }}
      >
        <Link
          href="/"
          className="flex items-center gap-2"
          style={{
            fontFamily: displayFont,
            fontWeight: 600,
            fontSize: 17,
            letterSpacing: "-0.5px",
            color: T.ink,
          }}
        >
          SiteForge
        </Link>

        <nav className="hidden md:flex items-center gap-7 mx-auto">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="fc-navlink"
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "-0.14px",
                color: T.inkMuted,
              }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2 ml-auto md:ml-0">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            className="fc-pill flex items-center justify-center"
            style={{
              width: 38,
              height: 38,
              borderRadius: 9999,
              background: T.surface1,
              color: T.ink,
            }}
          >
            <GithubIcon size={16} />
          </a>
          <PillSecondary href="/extract">Open extractor</PillSecondary>
          <PillPrimary onClick={onClone}>Clone a site</PillPrimary>
        </div>

        <div className="flex md:hidden items-center gap-2 ml-auto">
          <PillPrimary onClick={onClone}>Clone</PillPrimary>
          <button
            aria-label="Menu"
            onClick={() => setOpen(!open)}
            className="flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              borderRadius: 9999,
              background: T.surface1,
              color: T.ink,
            }}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="md:hidden"
            style={{
              background: T.canvas,
              borderTop: `1px solid ${T.hairlineSoft}`,
              padding: "8px 20px 16px",
            }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 160, damping: 22 }}
          >
            {links.map((l, index) => (
              <motion.a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block"
                style={{
                  color: T.ink,
                  fontSize: 15,
                  letterSpacing: "-0.15px",
                  padding: "12px 0",
                }}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.04 }}
              >
                {l.label}
              </motion.a>
            ))}
            <Link
              href="/extract"
              className="block"
              style={{ color: T.inkMuted, fontSize: 15, padding: "12px 0" }}
            >
              Open extractor
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
              style={{ color: T.inkMuted, fontSize: 15, padding: "12px 0" }}
            >
              <GithubIcon size={15} /> GitHub
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}

/* ── Hero preview board: clean product mockup + export summary ── */
function HeroPreviewBoard() {
  const exportTiles = [
    {
      title: "Vanilla HTML",
      detail: "Static pages with assets and scripts bundled.",
      tone: "#8B3DFF",
    },
    {
      title: "React + Vite",
      detail: "Real JSX components with shared sections deduped.",
      tone: "#E44BE0",
    },
    {
      title: "Next.js",
      detail: "Pages Router app with metadata and global styles.",
      tone: "#FF6B2C",
    },
  ];

  const qualitySignals = [
    { label: "Verified", value: "Framer only" },
    { label: "Export", value: "3 formats" },
    { label: "Delivery", value: "ZIP ready" },
  ];

  return (
    <motion.div
      className="fc-rise-2"
      style={{
        marginTop: 32,
        borderRadius: 28,
        padding: 14,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)), radial-gradient(120% 120% at 50% 0%, rgba(139,61,255,0.24), transparent 48%), rgba(26,25,24,0.88)",
        border: `1px solid ${T.hairlineSoft}`,
        boxShadow:
          "0 30px 80px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
      initial={{ opacity: 0, y: 24, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.22 }}
      transition={{ type: "spring", stiffness: 90, damping: 18, delay: 0.04 }}
      whileHover={{ y: -4 }}
    >
      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "minmax(0, 1.12fr) minmax(280px, 0.88fr)",
          alignItems: "stretch",
        }}
      >
        <motion.div
          style={{
            borderRadius: 22,
            padding: 22,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)), radial-gradient(120% 120% at 0% 0%, rgba(228,75,224,0.18), transparent 40%), #0e0d0c",
            border: `1px solid ${T.hairlineSoft}`,
          }}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: 22 }}
          >
            <div className="flex items-center gap-2">
              <span className="fc-dot" />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: T.inkMuted,
                }}
              >
                site preview
              </span>
            </div>
            <span
              style={{
                fontSize: 12,
                letterSpacing: "-0.12px",
                color: T.inkMuted,
                background: T.surface1,
                borderRadius: 9999,
                padding: "5px 12px",
              }}
            >
              saasly.framer.website
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            }}
          >
            <motion.div
              style={{
                minHeight: 188,
                borderRadius: 20,
                padding: 20,
                background:
                  "linear-gradient(135deg, rgba(139,61,255,0.95), rgba(228,75,224,0.78) 58%, rgba(255,107,44,0.58))",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.75)",
                  }}
                >
                  clean delivery
                </p>
                <h3
                  style={{
                    fontFamily: displayFont,
                    fontWeight: 500,
                    fontSize: "clamp(26px, 3vw, 38px)",
                    lineHeight: 0.98,
                    letterSpacing: "-0.05em",
                    marginTop: 12,
                    color: "#fff",
                  }}
                >
                  Keep the motion.
                  <br />
                  Lose the clutter.
                </h3>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 20,
                }}
              >
                {qualitySignals.map((item) => (
                  <span
                    key={item.label}
                    style={{
                      fontSize: 12,
                      color: "#fff",
                      background: "rgba(0,0,0,0.18)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 9999,
                      padding: "7px 10px",
                    }}
                  >
                    <strong style={{ fontWeight: 600 }}>{item.label}:</strong>{" "}
                    {item.value}
                  </span>
                ))}
              </div>
            </motion.div>

            <motion.div
              style={{
                minHeight: 188,
                borderRadius: 20,
                padding: 18,
                background: T.canvas,
                border: `1px solid ${T.hairlineSoft}`,
              }}
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: T.inkMuted,
                  }}
                >
                  export matrix
                </span>
                <span
                  style={{
                    fontSize: 12,
                    letterSpacing: "-0.12px",
                    color: T.inkMuted,
                  }}
                >
                  3 formats
                </span>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {exportTiles.map((tile) => (
                  <motion.div
                    key={tile.title}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "14px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "start",
                      padding: "12px 0",
                      borderTop: `1px solid ${T.hairlineSoft}`,
                    }}
                    whileHover={{ x: 2 }}
                    transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 9999,
                        background: tile.tone,
                        marginTop: 4,
                      }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          letterSpacing: "-0.14px",
                          color: T.ink,
                        }}
                      >
                        {tile.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12.5,
                          lineHeight: 1.45,
                          letterSpacing: "-0.13px",
                          color: T.inkMuted,
                          marginTop: 4,
                        }}
                      >
                        {tile.detail}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>

          <div
            style={{
              marginTop: 14,
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            }}
          >
            {[
              { value: "7", label: "pages crawled" },
              { value: "24", label: "images mirrored" },
              { value: "131", label: "fonts preserved" },
            ].map((stat) => (
              <motion.div
                key={stat.label}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${T.hairlineSoft}`,
                  borderRadius: 16,
                  padding: "14px 16px",
                }}
                whileHover={{ y: -2 }}
                transition={{ type: "spring", stiffness: 280, damping: 24 }}
              >
                <motion.div
                  style={{
                    fontFamily: displayFont,
                    fontSize: 26,
                    fontWeight: 500,
                    letterSpacing: "-0.05em",
                    lineHeight: 1,
                  }}
                >
                  {stat.value}
                </motion.div>
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: "-0.12px",
                    color: T.inkMuted,
                    marginTop: 5,
                  }}
                >
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          style={{
            borderRadius: 22,
            padding: 22,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)), radial-gradient(110% 120% at 100% 0%, rgba(255,107,44,0.14), transparent 38%), #0e0d0c",
            border: `1px solid ${T.hairlineSoft}`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
        >
          <div>
            <p
              style={{
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: T.inkMuted,
              }}
            >
              open source
            </p>
            <h3
              style={{
                fontFamily: displayFont,
                fontSize: 28,
                lineHeight: 1,
                letterSpacing: "-0.05em",
                marginTop: 10,
              }}
            >
              Built for teams who care about quality.
            </h3>
            <p
              style={{
                fontSize: 15,
                lineHeight: 1.5,
                letterSpacing: "-0.15px",
                color: T.inkMuted,
                marginTop: 12,
              }}
            >
              Test it locally, improve the output, and share the result back as
              a pull request. The product gets stronger with every contribution.
            </p>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
            {[
              { label: "Community ready", value: "Contributions welcome" },
              { label: "Safe to use", value: "Only published Framer sites" },
              { label: "Export goal", value: "Clean, tidy, production-ready" },
            ].map((row) => (
              <motion.div
                key={row.label}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: T.surface1,
                  border: `1px solid ${T.hairlineSoft}`,
                }}
                whileHover={{ x: 2 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: T.inkMuted,
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    letterSpacing: "-0.14px",
                    color: T.ink,
                    marginTop: 4,
                  }}
                >
                  {row.value}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ── Page ── */
export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [focused, setFocused] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scrollProgress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 28,
    mass: 0.2,
  });

  const focusInput = () => document.getElementById("hero-url-input")?.focus();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    const full = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    router.push(`/clone?url=${encodeURIComponent(full)}`);
  };

  const formats = [
    {
      name: "Vanilla HTML",
      icon: FileCode2,
      detail:
        "Self-contained pages with the site's JavaScript runtime inlined. Unzip, open index.html, done.",
      chip: "file:// ready",
      tint: "#8B3DFF",
      status: { label: "Stable", color: "#4ADE80" },
    },
    {
      name: "React + Vite",
      icon: Atom,
      detail:
        "Real JSX components, one file per section, shared header and footer deduped. No HTML blobs.",
      chip: "npm run dev",
      tint: "#E44BE0",
      status: { label: "Beta", color: "#FBBF24" },
    },
    {
      name: "Next.js",
      icon: Layers,
      detail:
        "Pages Router project with per-page metadata and a global stylesheet. Push to Vercel as-is.",
      chip: "next build",
      tint: "#FF6B2C",
      status: { label: "Beta", color: "#FBBF24" },
    },
  ];

  const steps = [
    {
      n: "1",
      title: "Paste a Framer URL",
      body: "Any published Framer site works: yoursite.framer.website or a custom domain. Non-Framer sites are rejected up front.",
    },
    {
      n: "2",
      title: "We crawl and rebuild",
      body: "Every page, image, font, and script chunk is mirrored. The module graph is re-bundled so interactions survive offline.",
    },
    {
      n: "3",
      title: "Download the ZIP",
      body: "Pick vanilla, React, or Next.js. Watermarks and tracking scripts are stripped; what's left is just the site.",
    },
  ];

  const faqs = [
    {
      q: "Which sites can I clone?",
      a: "Framer sites only. The tool checks the URL before crawling and refuses anything built on other platforms. That focus is what makes the output reliable.",
    },
    {
      q: "Do animations and interactions survive?",
      a: "Yes. The vanilla export bundles the site's JavaScript runtime into each page, so scroll effects, sticky navs, and appear animations work from a plain file:// open.",
    },
    {
      q: "What does the React export look like?",
      a: "A real project: one component file per section (SiteHeader.jsx, Hero.jsx, and so on), shared sections deduped, global CSS imported once. No JSON payloads, no dangerouslySetInnerHTML.",
    },
    {
      q: "Can I clone someone else's site?",
      a: "Only clone sites you own or have permission to copy. The tool removes platform badges, not copyright. The design still belongs to its author.",
    },
    {
      q: "Is SiteForge open source?",
      a: "Yes. The whole extractor lives on GitHub. The vanilla export is stable; React and Next.js exports work but are still in beta, and issues or pull requests that push their fidelity forward are very welcome.",
    },
  ];

  return (
    <>
      <Head>
        <title>SiteForge - Clone Framer Sites to HTML, React & Next.js</title>

        <meta
          name="description"
          content="Paste a Framer URL and export the full site as clean HTML, React, or Next.js. Keep animations, assets, pages, and styles in a downloadable ZIP."
        />

        <meta
          name="keywords"
          content="Framer site cloner, Framer export, clone Framer website, Framer to HTML, Framer to React, Framer to Next.js, SiteForge"
        />

        <meta name="robots" content="index, follow" />
        <meta name="author" content="SiteForge" />
        <meta name="theme-color" content="#0B0A09" />

        <link rel="canonical" href="https://your-domain.com/" />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="SiteForge" />
        <meta
          property="og:title"
          content="SiteForge - Clone Framer Sites to HTML, React & Next.js"
        />
        <meta
          property="og:description"
          content="Turn a published Framer site into clean HTML, React, or Next.js with animations, assets, and pages preserved."
        />
        {/* TODO */}
        <meta property="og:url" content="" />
        <meta property="og:image" content="" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content="SiteForge Framer site cloning tool preview"
        />

        {/* Twitter / X */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="SiteForge - Clone Framer Sites to HTML, React & Next.js"
        />
        <meta
          name="twitter:description"
          content="Paste a Framer URL and export the site as clean HTML, React, or Next.js."
        />
        <meta name="twitter:image" content="" />

        {/* Favicons */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>

      <style jsx global>{`
        .fc-root {
          background: ${T.canvas};
          color: ${T.ink};
          font-family: ${bodyFont};
          font-feature-settings: ${bodyFeatures};
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
        }
        .fc-root ::selection {
          background: rgba(0, 153, 255, 0.35);
        }
        .fc-pill {
          transition:
            transform 0.15s ease,
            opacity 0.15s ease;
        }
        .fc-pill:hover {
          opacity: 0.92;
        }
        .fc-pill:active {
          transform: scale(0.97);
        }
        .fc-pill:focus-visible,
        .fc-navlink:focus-visible,
        .fc-faq summary:focus-visible {
          outline: none;
          box-shadow:
            rgba(0, 153, 255, 0.15) 0 0 0 1px,
            ${T.accent} 0 0 0 2px;
        }
        .fc-navlink {
          transition: color 0.15s ease;
        }
        .fc-navlink:hover {
          color: ${T.ink};
        }
        .fc-faq summary::-webkit-details-marker {
          display: none;
        }
        .fc-faq summary {
          cursor: pointer;
          list-style: none;
        }
        .fc-faq[open] .fc-faq-icon {
          transform: rotate(45deg);
        }
        .fc-faq-icon {
          transition: transform 0.2s ease;
        }
        /* hero aurora + masked grid */
        .fc-hero {
          position: relative;
        }
        .fc-hero::before {
          content: "";
          position: absolute;
          inset: -56px 0 0 0;
          pointer-events: none;
          background:
            radial-gradient(
              640px 420px at 50% -80px,
              rgba(139, 61, 255, 0.3),
              transparent 70%
            ),
            radial-gradient(
              980px 560px at 50% -40px,
              rgba(228, 75, 224, 0.12),
              transparent 62%
            ),
            radial-gradient(
              1200px 700px at 50% 10%,
              rgba(255, 107, 44, 0.05),
              transparent 60%
            );
        }
        .fc-hero::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
            linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.045) 1px,
              transparent 1px
            );
          background-size: 72px 72px;
          -webkit-mask-image: radial-gradient(
            ellipse 72% 56% at 50% 0%,
            black 20%,
            transparent 72%
          );
          mask-image: radial-gradient(
            ellipse 72% 56% at 50% 0%,
            black 20%,
            transparent 72%
          );
        }
        .fc-hero > * {
          position: relative;
          z-index: 1;
        }
        .fc-gradient-word {
          background: linear-gradient(
            100deg,
            #a06bff 0%,
            #e44be0 55%,
            #ff8a5c 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .fc-dot {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: #a06bff;
          box-shadow: 0 0 10px rgba(160, 107, 255, 0.9);
          animation: fc-pulse 2.4s ease-in-out infinite;
        }
        .fc-caret {
          display: inline-block;
          width: 8px;
          height: 15px;
          margin-top: 6px;
          background: rgba(255, 255, 255, 0.6);
          animation: fc-blink 1.1s step-end infinite;
        }
        .fc-format-card {
          position: relative;
          transition:
            transform 0.25s ease,
            border-color 0.25s ease;
          border: 1px solid ${T.hairlineSoft};
        }
        .fc-format-card:hover {
          transform: translateY(-4px);
          border-color: ${T.hairline};
        }
        .fc-rise-1 {
          animation: fc-rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .fc-rise-2 {
          animation: fc-rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both;
        }
        @keyframes fc-rise {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fc-pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
        @keyframes fc-blink {
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .fc-root * {
            transition: none !important;
            animation: none !important;
          }
        }
      `}</style>

      <div className="fc-root min-h-screen">
        <motion.div
          aria-hidden="true"
          className="fixed left-0 top-0 z-50 h-px w-full origin-left bg-gradient-to-r from-[#a06bff] via-[#e44be0] to-[#ff8a5c]"
          style={{ scaleX: scrollProgress }}
        />
        <TopNav onClone={focusInput} />

        {/* ── Hero: aurora, poster type, input pill, clean preview ── */}
        <section
          className="fc-hero mx-auto text-center"
          style={{ maxWidth: 1199, padding: "96px 20px 88px" }}
        >
          <motion.div
            className="fc-rise-1"
            style={{ maxWidth: 860, margin: "0 auto" }}
            variants={stagger}
            initial={prefersReducedMotion ? false : "hidden"}
            animate={prefersReducedMotion ? undefined : "show"}
          >
            <motion.span
              className="inline-flex items-center gap-2"
              style={{
                background: "rgba(26,25,24,0.8)",
                border: `1px solid ${T.hairline}`,
                borderRadius: 100,
                padding: "7px 14px",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.13px",
                color: "rgba(255,255,255,0.8)",
              }}
              variants={fadeUp}
            >
              <span className="fc-dot" />
              Framer sites only, by design
            </motion.span>

            <motion.h1
              style={{
                fontFamily: displayFont,
                fontWeight: 500,
                fontSize: "clamp(42px, 8vw, 92px)",
                lineHeight: 0.94,
                letterSpacing: "-0.05em",
                margin: "26px auto 0",
                maxWidth: 760,
              }}
              variants={fadeUp}
            >
              Clone polished
              <br />
              <span className="fc-gradient-word">Framer</span> sites.
            </motion.h1>
            <motion.p
              style={{
                fontSize: 18,
                lineHeight: 1.4,
                letterSpacing: "-0.18px",
                color: T.inkMuted,
                maxWidth: 520,
                margin: "26px auto 0",
              }}
              variants={fadeUp}
            >
              Paste a URL and turn a published Framer site into clean HTML,
              React, or Next.js with a workflow that feels production-ready.
            </motion.p>

            <motion.form
              onSubmit={handleSubmit}
              style={{ maxWidth: 560, margin: "36px auto 0" }}
              variants={fadeUp}
              whileHover={prefersReducedMotion ? undefined : { y: -1 }}
            >
              <div
                className="flex items-center"
                style={{
                  background: "rgba(26,25,24,0.9)",
                  borderRadius: 100,
                  padding: "6px 6px 6px 22px",
                  border: `1px solid ${T.hairline}`,
                  boxShadow: focused
                    ? "rgba(0,153,255,0.15) 0 0 0 1px, 0 18px 40px rgba(0,0,0,0.35)"
                    : "0 18px 40px rgba(0,0,0,0.35)",
                  transition: "box-shadow 0.15s ease",
                }}
              >
                <input
                  id="hero-url-input"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="yoursite.framer.website"
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 bg-transparent outline-none min-w-0"
                  style={{
                    fontSize: 15,
                    letterSpacing: "-0.15px",
                    color: T.ink,
                    padding: "9px 0",
                  }}
                />
                <PillPrimary type="submit">
                  Clone it
                  <ArrowRight size={14} strokeWidth={2.25} />
                </PillPrimary>
              </div>
            </motion.form>
            <motion.p
              style={{
                fontSize: 12,
                letterSpacing: "-0.12px",
                color: T.inkMuted,
                marginTop: 14,
              }}
              variants={fadeUp}
            >
              Free and open source · no account needed ·{" "}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: T.accent, textDecoration: "none" }}
              >
                star it on GitHub
              </a>
            </motion.p>
          </motion.div>

          <HeroPreviewBoard />
        </section>

        {/* ── Formats: three tinted tiles ── */}
        <motion.section
          id="formats"
          className="mx-auto"
          style={{ maxWidth: 1199, padding: "40px 20px 96px" }}
          variants={stagger}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView={prefersReducedMotion ? undefined : "show"}
          viewport={{ once: true, amount: 0.22 }}
        >
          <motion.p
            variants={fadeUp}
            style={{
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: T.inkMuted,
            }}
          >
            Exports
          </motion.p>
          <motion.h2
            style={{
              fontFamily: displayFont,
              fontWeight: 500,
              fontSize: "clamp(30px, 4.6vw, 62px)",
              lineHeight: 1,
              letterSpacing: "-0.05em",
              marginTop: 10,
            }}
            variants={fadeUp}
          >
            One site, three exports.
          </motion.h2>
          <div className="grid gap-4 mt-10 md:grid-cols-3">
            {formats.map((f) => (
              <motion.div
                key={f.name}
                className="fc-format-card"
                style={{
                  background: T.surface1,
                  borderRadius: 20,
                  padding: 24,
                  overflow: "hidden",
                }}
                variants={fadeUp}
                whileHover={{ y: -6, scale: 1.01 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
              >
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 24,
                    right: 24,
                    height: 1,
                    background: `linear-gradient(90deg, transparent, ${f.tint}66, transparent)`,
                  }}
                />
                <div className="flex items-center justify-between">
                  <span
                    className="flex items-center justify-center"
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      background: `${f.tint}1F`,
                      color: f.tint,
                    }}
                  >
                    <f.icon size={18} />
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      letterSpacing: "-0.12px",
                      color: T.inkMuted,
                      background: T.surface2,
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {f.chip}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2"
                  style={{ marginTop: 16 }}
                >
                  <p
                    style={{
                      fontFamily: bodyFont,
                      fontWeight: 700,
                      fontSize: 22,
                      letterSpacing: "-0.8px",
                      lineHeight: 1.2,
                    }}
                  >
                    {f.name}
                  </p>
                  <span
                    className="inline-flex items-center gap-1"
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "-0.11px",
                      color: f.status.color,
                      background: `${f.status.color}1A`,
                      border: `1px solid ${f.status.color}33`,
                      borderRadius: 100,
                      padding: "3px 8px",
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: 9999,
                        background: f.status.color,
                      }}
                    />
                    {f.status.label}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.4,
                    letterSpacing: "-0.15px",
                    color: T.inkMuted,
                    marginTop: 8,
                  }}
                >
                  {f.detail}
                </p>
              </motion.div>
            ))}
          </div>
          <motion.p
            className="flex flex-wrap items-center gap-1.5"
            style={{
              fontSize: 13,
              letterSpacing: "-0.13px",
              color: T.inkMuted,
              marginTop: 20,
              lineHeight: 1.5,
            }}
            variants={fadeUp}
          >
            React and Next.js exports build and render today; component naming
            and fidelity keep improving with every release. SiteForge is open
            source, so
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: T.accent, textDecoration: "none" }}
            >
              <GithubIcon size={13} /> contributions are welcome
            </a>
            .
          </motion.p>
        </motion.section>

        {/* ── Spotlight band: violet gradient card + mockup tile ── */}
        <motion.section
          className="mx-auto"
          style={{ maxWidth: 1199, padding: "0 20px 96px" }}
          variants={stagger}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView={prefersReducedMotion ? undefined : "show"}
          viewport={{ once: true, amount: 0.22 }}
        >
          <div className="grid gap-4 md:grid-cols-2 items-stretch">
            <motion.div
              className="flex flex-col justify-between"
              style={{
                background: T.gradientVioletCard,
                borderRadius: 30,
                padding: 30,
                minHeight: 340,
              }}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "-0.13px",
                  color: "rgba(255,255,255,0.75)",
                }}
              >
                The part everyone gets wrong
              </span>
              <div>
                <h3
                  style={{
                    fontFamily: displayFont,
                    fontWeight: 500,
                    fontSize: "clamp(28px, 3.4vw, 44px)",
                    lineHeight: 1,
                    letterSpacing: "-0.04em",
                  }}
                >
                  Screenshots freeze.
                  <br />
                  Clones shouldn&rsquo;t.
                </h3>
                <p
                  style={{
                    fontSize: 22,
                    lineHeight: 1.35,
                    letterSpacing: "-0.01px",
                    color: "rgba(255,255,255,0.85)",
                    marginTop: 16,
                    maxWidth: 420,
                    fontWeight: 400,
                  }}
                >
                  The Framer runtime ships inside the ZIP, so scroll effects,
                  hovers, and appear animations keep moving.
                </p>
              </div>
            </motion.div>

            <motion.div
              style={{
                background: T.surface1,
                borderRadius: 20,
                padding: 16,
                boxShadow:
                  "inset 0 0.5px 0 rgba(255,255,255,0.10), 0px 10px 30px rgba(0,0,0,0.25)",
              }}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
            >
              <div
                style={{
                  background: T.canvas,
                  borderRadius: 12,
                  overflow: "hidden",
                  height: "100%",
                }}
              >
                <div
                  className="flex items-center gap-1.5"
                  style={{
                    padding: "10px 14px",
                    borderBottom: `1px solid ${T.hairlineSoft}`,
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 9999,
                        background: "rgba(255,255,255,0.16)",
                      }}
                    />
                  ))}
                  <span
                    style={{
                      marginLeft: 10,
                      fontSize: 12,
                      letterSpacing: "-0.12px",
                      color: T.inkMuted,
                      background: T.surface1,
                      borderRadius: 6,
                      padding: "3px 10px",
                    }}
                  >
                    file:///your-site/index.html
                  </span>
                </div>
                <div style={{ padding: 22 }}>
                  <div
                    style={{
                      fontFamily: displayFont,
                      fontWeight: 600,
                      fontSize: 26,
                      letterSpacing: "-1.2px",
                      lineHeight: 1,
                      color: T.ink,
                    }}
                  >
                    Still animated.
                    <br />
                    Still yours.
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[0.09, 0.06, 0.12].map((o, i) => (
                      <div
                        key={i}
                        style={{
                          height: 44,
                          borderRadius: 10,
                          background: `rgba(255,255,255,${o})`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#111",
                        background: T.ink,
                        borderRadius: 100,
                        padding: "6px 12px",
                      }}
                    >
                      Opens offline
                    </span>
                    <span style={{ fontSize: 12, color: T.inkMuted }}>
                      no server, no build step
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.section>

        {/* ── How it works: numbered rail ── */}
        <motion.section
          id="how"
          className="mx-auto"
          style={{ maxWidth: 1199, padding: "0 20px 96px" }}
          variants={stagger}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView={prefersReducedMotion ? undefined : "show"}
          viewport={{ once: true, amount: 0.2 }}
        >
          <motion.p
            style={{
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: T.inkMuted,
            }}
            variants={fadeUp}
          >
            Process
          </motion.p>
          <motion.h2
            style={{
              fontFamily: displayFont,
              fontWeight: 500,
              fontSize: "clamp(30px, 4.6vw, 62px)",
              lineHeight: 1,
              letterSpacing: "-0.05em",
              marginTop: 10,
            }}
            variants={fadeUp}
          >
            Three minutes, start to ZIP.
          </motion.h2>
          <div className="mt-10">
            {steps.map((s, i) => (
              <motion.div
                key={s.n}
                className="grid md:grid-cols-[64px_280px_1fr] gap-2 md:gap-6 items-baseline"
                style={{
                  padding: "26px 0",
                  borderTop: `1px solid ${T.hairlineSoft}`,
                  borderBottom:
                    i === steps.length - 1
                      ? `1px solid ${T.hairlineSoft}`
                      : "none",
                }}
                variants={fadeUp}
                whileHover={{ x: 2 }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
              >
                <span
                  className="flex items-center justify-center"
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 9999,
                    background: T.surface1,
                    border: `1px solid ${T.hairline}`,
                    fontFamily: displayFont,
                    fontWeight: 500,
                    fontSize: 16,
                    letterSpacing: "-0.4px",
                    color: T.ink,
                  }}
                >
                  {s.n}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 22,
                    letterSpacing: "-0.8px",
                    lineHeight: 1.2,
                  }}
                >
                  {s.title}
                </span>
                <p
                  style={{
                    fontSize: 15,
                    lineHeight: 1.4,
                    letterSpacing: "-0.15px",
                    color: T.inkMuted,
                    maxWidth: 560,
                  }}
                >
                  {s.body}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── FAQ ── */}
        <motion.section
          id="faq"
          className="mx-auto"
          style={{ maxWidth: 860, padding: "0 20px 96px" }}
          variants={stagger}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView={prefersReducedMotion ? undefined : "show"}
          viewport={{ once: true, amount: 0.2 }}
        >
          <motion.h2
            style={{
              fontFamily: displayFont,
              fontWeight: 500,
              fontSize: "clamp(30px, 4.6vw, 62px)",
              lineHeight: 1,
              letterSpacing: "-0.05em",
            }}
            variants={fadeUp}
          >
            Questions, answered.
          </motion.h2>
          <div className="mt-8">
            {faqs.map((f) => (
              <motion.div
                key={f.q}
                variants={fadeUp}
                whileHover={{ x: 2 }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
              >
                <details
                  className="fc-faq"
                  style={{ borderBottom: `1px solid ${T.hairlineSoft}` }}
                >
                  <summary
                    className="flex items-center justify-between gap-4"
                    style={{
                      padding: "24px 0",
                      fontSize: 15,
                      fontWeight: 500,
                      letterSpacing: "-0.15px",
                    }}
                  >
                    {f.q}
                    <span
                      className="fc-faq-icon flex items-center justify-center shrink-0"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9999,
                        background: T.surface1,
                        fontSize: 15,
                        color: T.inkMuted,
                      }}
                    >
                      +
                    </span>
                  </summary>
                  <p
                    style={{
                      fontSize: 15,
                      lineHeight: 1.4,
                      letterSpacing: "-0.15px",
                      color: T.inkMuted,
                      padding: "0 44px 24px 0",
                    }}
                  >
                    {f.a}
                  </p>
                </details>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ── Closing spotlight: orange CTA card ── */}
        <motion.section
          className="mx-auto"
          style={{ maxWidth: 1199, padding: "0 20px 96px" }}
          variants={stagger}
          initial={prefersReducedMotion ? false : "hidden"}
          whileInView={prefersReducedMotion ? undefined : "show"}
          viewport={{ once: true, amount: 0.22 }}
        >
          <motion.div
            className="text-center"
            style={{
              background: T.gradientOrangeCard,
              borderRadius: 30,
              padding: "72px 30px",
            }}
            variants={fadeUp}
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
          >
            <motion.h2
              style={{
                fontFamily: displayFont,
                fontWeight: 500,
                fontSize: "clamp(38px, 6.4vw, 85px)",
                lineHeight: 0.95,
                letterSpacing: "-0.05em",
              }}
              variants={fadeUp}
            >
              Own the code.
            </motion.h2>
            <motion.p
              style={{
                fontSize: 18,
                lineHeight: 1.3,
                letterSpacing: "-0.18px",
                color: "rgba(255,255,255,0.85)",
                marginTop: 18,
              }}
              variants={fadeUp}
            >
              Your Framer site, unhosted and unlocked.
            </motion.p>
            <motion.div
              className="flex flex-wrap justify-center gap-2"
              style={{ marginTop: 28 }}
              variants={fadeUp}
            >
              <PillPrimary
                onClick={() => {
                  focusInput();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Start cloning
                <ArrowRight size={14} strokeWidth={2.25} />
              </PillPrimary>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="fc-pill inline-flex items-center gap-1.5"
                style={{
                  background: "rgba(0,0,0,0.25)",
                  color: T.ink,
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "-0.14px",
                  padding: "10px 15px",
                  borderRadius: 100,
                  lineHeight: 1,
                }}
              >
                <Star size={14} />
                Star on GitHub
              </a>
            </motion.div>
          </motion.div>
        </motion.section>

        {/* ── Footer ── */}
        <footer
          style={{
            borderTop: `1px solid ${T.hairlineSoft}`,
            padding: "64px 32px",
          }}
        >
          <div
            className="mx-auto flex flex-col md:flex-row gap-8 md:items-start justify-between"
            style={{ maxWidth: 1199 }}
          >
            <div>
              <span
                style={{
                  fontFamily: displayFont,
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
                  color: T.inkMuted,
                  marginTop: 8,
                  maxWidth: 320,
                  lineHeight: 1.4,
                }}
              >
                A focused tool for extracting published Framer sites into code
                you can keep. Clone only what you own.
              </p>
            </div>
            <div className="flex flex-wrap gap-14">
              <div>
                <p
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
                  <a
                    key={l.label}
                    href={l.href}
                    className="fc-navlink block"
                    style={{
                      fontSize: 13,
                      letterSpacing: "-0.13px",
                      color: T.inkMuted,
                      padding: "5px 0",
                    }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
              <div>
                <p
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
                  className="fc-navlink flex items-center gap-1.5"
                  style={{
                    fontSize: 13,
                    letterSpacing: "-0.13px",
                    color: T.inkMuted,
                    padding: "5px 0",
                  }}
                >
                  <GithubIcon size={13} /> GitHub
                </a>
                <a
                  href={`${GITHUB_URL}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fc-navlink block"
                  style={{
                    fontSize: 13,
                    letterSpacing: "-0.13px",
                    color: T.inkMuted,
                    padding: "5px 0",
                  }}
                >
                  Report an issue
                </a>
              </div>
              <div>
                <p
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
                    color: T.inkMuted,
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
              color: T.inkMuted,
              marginTop: 40,
            }}
          >
            © {new Date().getFullYear()} SiteForge. Not affiliated with Framer
            B.V.
          </p>
        </footer>
      </div>
    </>
  );
}

(Home as any).disableShell = true;
