export interface DetectedDeps {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Human-readable notes for the README */
  notes: string[];
}

// ─── Detection rules ────────────────────────────────────────────────────────

interface ScriptRule {
  pattern: RegExp;
  pkg: string;
  version: string;
  dev?: boolean;
}

/** Match against any <script src>, <link href>, or inline JS code in the HTML */
const SCRIPT_RULES: ScriptRule[] = [
  // Animation
  { pattern: /gsap(?:\.min)?\.js|cdnjs.*gsap|TweenMax|TweenLite|@gsap\//i, pkg: "gsap", version: "^3.12.0" },
  { pattern: /ScrollTrigger(?:\.min)?\.js/i, pkg: "gsap", version: "^3.12.0" }, // bundled in gsap
  { pattern: /\baos(?:\.min)?\.js\b/i, pkg: "aos", version: "^2.3.4" },
  { pattern: /scrollreveal(?:\.min)?\.js/i, pkg: "scrollreveal", version: "^4.0.9" },
  { pattern: /lenis(?:\.min)?\.js|@studio-freight\/lenis/i, pkg: "lenis", version: "^1.1.0" },
  { pattern: /locomotive-scroll/i, pkg: "locomotive-scroll", version: "^4.1.4" },
  { pattern: /splitting(?:\.min)?\.js/i, pkg: "splitting", version: "^1.0.6" },
  { pattern: /ScrollMagic(?:\.min)?\.js/i, pkg: "scrollmagic", version: "^2.0.8" },
  { pattern: /anime(?:\.min)?\.js|animejs/i, pkg: "animejs", version: "^3.2.2" },
  { pattern: /motion(?:\.min)?\.js|@motionone\/dom/i, pkg: "motion", version: "^10.18.0" },
  { pattern: /barba(?:\.min)?\.js|@barba\/core/i, pkg: "@barba/core", version: "^2.9.7" },
  { pattern: /velocity(?:\.min)?\.js/i, pkg: "velocity-animate", version: "^2.0.6" },
  // UI / sliders
  { pattern: /swiper(?:\.min)?\.js|swiperjs/i, pkg: "swiper", version: "^11.0.0" },
  { pattern: /embla-carousel(?!-react)/i, pkg: "embla-carousel", version: "^8.0.0" },
  { pattern: /keen-slider/i, pkg: "keen-slider", version: "^6.8.6" },
  { pattern: /glide(?:\.min)?\.js|@glidejs\//i, pkg: "@glidejs/glide", version: "^3.7.2" },
  { pattern: /slick(?:\.min)?\.js|slick-carousel/i, pkg: "slick-carousel", version: "^1.8.1" },
  { pattern: /isotope(?:\.min)?\.js/i, pkg: "isotope-layout", version: "^3.0.6" },
  { pattern: /masonry(?:\.min)?\.js/i, pkg: "masonry-layout", version: "^4.2.2" },
  // Lightbox / media
  { pattern: /glightbox(?:\.min)?\.js/i, pkg: "glightbox", version: "^3.3.0" },
  { pattern: /fslightbox/i, pkg: "fslightbox-react", version: "^1.7.6" },
  { pattern: /plyr(?:\.min)?\.js/i, pkg: "plyr", version: "^3.7.8" },
  // Lottie
  { pattern: /lottie(?:-web|-player|\.min)?\.js/i, pkg: "lottie-web", version: "^5.12.0" },
  // Typed / text
  { pattern: /typed(?:\.min)?\.js/i, pkg: "typed.js", version: "^2.1.0" },
  { pattern: /typewriter-effect/i, pkg: "typewriter-effect", version: "^2.21.0" },
  // Particles
  { pattern: /particles(?:\.min)?\.js|tsparticles/i, pkg: "tsparticles", version: "^3.0.0" },
  // 3D / canvas
  { pattern: /three(?:\.min)?\.js|three\/build\//i, pkg: "three", version: "^0.169.0" },
  { pattern: /p5(?:\.min)?\.js/i, pkg: "p5", version: "^1.9.0" },
  // Chart
  { pattern: /chart(?:\.min)?\.js|chartjs/i, pkg: "chart.js", version: "^4.4.0" },
  { pattern: /d3(?:\.min)?\.js|d3-\w/i, pkg: "d3", version: "^7.9.0" },
  { pattern: /apexcharts/i, pkg: "apexcharts", version: "^3.53.0" },
  // CSS frameworks (via CDN link)
  { pattern: /bootstrap(?:\.min)?\.js/i, pkg: "bootstrap", version: "^5.3.0" },
  { pattern: /\bflatpickr/i, pkg: "flatpickr", version: "^4.6.13" },
  { pattern: /noUiSlider/i, pkg: "nouislider", version: "^15.8.0" },
  // Misc
  { pattern: /\bimagesloaded(?:\.min)?\.js/i, pkg: "imagesloaded", version: "^5.0.0" },
  { pattern: /\bwow(?:\.min)?\.js\b/i, pkg: "wowjs", version: "^1.1.3" },
  { pattern: /\bmixitup(?:\.min)?\.js/i, pkg: "mixitup", version: "^3.3.1" },
];

interface CssLinkRule {
  pattern: RegExp;
  pkg: string;
  version: string;
}

const CSS_LINK_RULES: CssLinkRule[] = [
  { pattern: /\baos(?:\.min)?\.css/i, pkg: "aos", version: "^2.3.4" },
  { pattern: /swiper(?:\.min)?\.css/i, pkg: "swiper", version: "^11.0.0" },
  { pattern: /animate(?:\.min)?\.css/i, pkg: "animate.css", version: "^4.1.1" },
  { pattern: /glightbox(?:\.min)?\.css/i, pkg: "glightbox", version: "^3.3.0" },
  { pattern: /bootstrap(?:\.min)?\.css/i, pkg: "bootstrap", version: "^5.3.0" },
  { pattern: /plyr(?:\.min)?\.css/i, pkg: "plyr", version: "^3.7.8" },
  { pattern: /flatpickr(?:\.min)?\.css/i, pkg: "flatpickr", version: "^4.6.13" },
  { pattern: /nouislider(?:\.min)?\.css/i, pkg: "nouislider", version: "^15.8.0" },
  { pattern: /splitting(?:\.min)?\.css/i, pkg: "splitting", version: "^1.0.6" },
];

/** Match against inline JS code snippets to find runtime initialization patterns */
const INLINE_JS_RULES: ScriptRule[] = [
  { pattern: /\bgsap\s*\.\s*(?:to|from|fromTo|timeline|registerPlugin)/i, pkg: "gsap", version: "^3.12.0" },
  { pattern: /\bAOS\s*\.\s*init\s*\(/i, pkg: "aos", version: "^2.3.4" },
  { pattern: /new\s+Swiper\s*\(/i, pkg: "swiper", version: "^11.0.0" },
  { pattern: /\bScrollReveal\s*\(\s*\)/i, pkg: "scrollreveal", version: "^4.0.9" },
  { pattern: /new\s+Lenis\s*\(/i, pkg: "lenis", version: "^1.1.0" },
  { pattern: /new\s+LocomotiveScroll\s*\(/i, pkg: "locomotive-scroll", version: "^4.1.4" },
  { pattern: /\bLottie\s*\.\s*(?:loadAnimation|create)/i, pkg: "lottie-web", version: "^5.12.0" },
  { pattern: /new\s+Typed\s*\(/i, pkg: "typed.js", version: "^2.1.0" },
  { pattern: /\banime\s*\(\s*{/i, pkg: "animejs", version: "^3.2.2" },
  { pattern: /\btsParticles\b|\bparticlesJS\s*\(/i, pkg: "tsparticles", version: "^3.0.0" },
  { pattern: /new\s+THREE\b|THREE\s*\.\s*(?:Scene|Camera|Renderer)/i, pkg: "three", version: "^0.169.0" },
  { pattern: /new\s+Chart\s*\(/i, pkg: "chart.js", version: "^4.4.0" },
  { pattern: /\bd3\s*\.\s*(?:select|scaleLinear|line\s*\()/i, pkg: "d3", version: "^7.9.0" },
  { pattern: /Splitting\s*\(\s*\)/i, pkg: "splitting", version: "^1.0.6" },
  { pattern: /new\s+Glide\s*\(/i, pkg: "@glidejs/glide", version: "^3.7.2" },
  { pattern: /\$\s*\(\s*['"][^'"]*['"]\s*\)\s*\.(?:slick|owlCarousel|magnificPopup)/i, pkg: "jquery", version: "^3.7.1" },
  { pattern: /\bBarba\s*\.\s*init\s*\(/i, pkg: "@barba/core", version: "^2.9.7" },
  { pattern: /new\s+ScrollMagic\s*\.\s*Controller/i, pkg: "scrollmagic", version: "^2.0.8" },
  { pattern: /\bwow\s*=\s*new\s+WOW\s*\(/i, pkg: "wowjs", version: "^1.1.3" },
  { pattern: /ApexCharts/i, pkg: "apexcharts", version: "^3.53.0" },
  { pattern: /\bemblaApi\b|EmblaCarousel\s*\(/i, pkg: "embla-carousel", version: "^8.0.0" },
  { pattern: /new\s+Plyr\s*\(/i, pkg: "plyr", version: "^3.7.8" },
];

/** Match against CSS content */
const CSS_RULES: Array<{ pattern: RegExp; pkg: string; version: string }> = [
  { pattern: /--tw-(?:ring|shadow|blur|translate|rotate|scale|skew)\b/, pkg: "tailwindcss", version: "^3.4.0" },
  { pattern: /\[data-aos\]/, pkg: "aos", version: "^2.3.4" },
  { pattern: /\.swiper-(?:wrapper|slide|container)\b/, pkg: "swiper", version: "^11.0.0" },
  { pattern: /\.glide(?:__track|__slides|__slide)\b/, pkg: "@glidejs/glide", version: "^3.7.2" },
  { pattern: /\.lottie-(?:player|container)\b/, pkg: "lottie-web", version: "^5.12.0" },
  { pattern: /\.splitting\b|\.word\b\s*>\s*\.char\b/, pkg: "splitting", version: "^1.0.6" },
  { pattern: /\.plyr(?:__|\s*{)/, pkg: "plyr", version: "^3.7.8" },
];

/** Platform → React-specific npm packages that give equivalent functionality */
const PLATFORM_DEPS: Record<string, Array<{ pkg: string; version: string; dev?: boolean; note: string }>> = {
  Framer: [
    { pkg: "framer-motion", version: "^11.0.0", note: "Framer site detected — framer-motion for React animations" },
  ],
  Webflow: [
    { pkg: "gsap", version: "^3.12.0", note: "Webflow often uses GSAP for interactions" },
  ],
};

// ─── Main function ───────────────────────────────────────────────────────────

export function detectNpmDependencies(
  pages: Array<{ html: string }>,
  css: string,
  manifest: { platform?: { name?: string } },
  framework: "react" | "nextjs",
): DetectedDeps {
  const deps: Record<string, string> = {};
  const devDeps: Record<string, string> = {};
  const notes: string[] = [];
  const seen = new Set<string>();

  function addDep(pkg: string, version: string, dev = false) {
    if (seen.has(pkg)) return;
    seen.add(pkg);
    if (dev) devDeps[pkg] = version;
    else deps[pkg] = version;
  }

  const allHtml = pages.map((p) => p.html).join("\n");

  // ── Script src / link href rules ──────────────────────────────────────────
  for (const m of allHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    for (const rule of SCRIPT_RULES) {
      if (rule.pattern.test(src)) addDep(rule.pkg, rule.version, rule.dev);
    }
  }
  for (const m of allHtml.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)) {
    const href = m[1];
    for (const rule of CSS_LINK_RULES) {
      if (rule.pattern.test(href)) addDep(rule.pkg, rule.version);
    }
  }

  // ── Inline JS init patterns ───────────────────────────────────────────────
  const inlineScripts: string[] = [];
  for (const m of allHtml.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1]) inlineScripts.push(m[1]);
  }
  const inlineJsText = inlineScripts.join("\n");
  for (const rule of INLINE_JS_RULES) {
    if (rule.pattern.test(inlineJsText)) addDep(rule.pkg, rule.version, rule.dev);
  }

  // ── CSS-based detection ───────────────────────────────────────────────────
  const allCss = css + "\n" + allHtml; // HTML may have inline <style> content
  for (const rule of CSS_RULES) {
    if (rule.pattern.test(allCss)) addDep(rule.pkg, rule.version);
  }

  // ── Tailwind heuristic (class-name patterns) ──────────────────────────────
  if (!seen.has("tailwindcss")) {
    const twClassPattern = /class=["'][^"']*\b(?:flex|grid|items-center|justify-between|px-\d|py-\d|text-\w+-\d{3}|bg-\w+-\d{3}|rounded-\w+|shadow-\w+|gap-\d)\b[^"']*/g;
    const twMatches = (allHtml.match(twClassPattern) || []).length;
    if (twMatches >= 5 || /cdn\.tailwindcss\.com/i.test(allHtml)) {
      addDep("tailwindcss", "^3.4.0", framework === "react");
      if (framework === "react") {
        addDep("autoprefixer", "^10.4.0", true);
        addDep("postcss", "^8.4.0", true);
      }
      notes.push("Tailwind CSS detected — run `npx tailwindcss init -p` to configure.");
    }
  }

  // ── Bootstrap heuristic ───────────────────────────────────────────────────
  if (!seen.has("bootstrap")) {
    const bsClassPattern = /\b(?:btn btn-|col-(?:sm|md|lg|xl)-\d|navbar-(?:brand|toggler|collapse)|modal-(?:dialog|content|header)|card-(?:body|header|footer))\b/;
    if (bsClassPattern.test(allHtml)) {
      addDep("bootstrap", "^5.3.0");
    }
  }

  // ── jQuery (needed by some older animation libs) ──────────────────────────
  if (!seen.has("jquery") && /\bjQuery\b|\$\s*\(/.test(inlineJsText)) {
    addDep("jquery", "^3.7.1");
  }

  // ── Platform-specific ─────────────────────────────────────────────────────
  const platformName = manifest.platform?.name || "";
  const platformRules = PLATFORM_DEPS[platformName] || [];
  for (const rule of platformRules) {
    addDep(rule.pkg, rule.version, rule.dev);
    notes.push(rule.note);
  }

  // ── AOS: also needs CSS init note ────────────────────────────────────────
  if (seen.has("aos")) {
    notes.push('AOS detected — add `import "aos/dist/aos.css"` and call `AOS.init()` in your entry file.');
  }
  if (seen.has("swiper")) {
    notes.push('Swiper detected — import `swiper/css` in your entry file.');
  }
  if (seen.has("lenis")) {
    notes.push("Lenis smooth scroll detected — initialize with `new Lenis()` and hook into your RAF loop.");
  }
  if (seen.has("gsap") && /ScrollTrigger/i.test(allHtml + inlineJsText)) {
    notes.push("GSAP ScrollTrigger detected — register with `gsap.registerPlugin(ScrollTrigger)` before use.");
  }

  return { dependencies: deps, devDependencies: devDeps, notes };
}
