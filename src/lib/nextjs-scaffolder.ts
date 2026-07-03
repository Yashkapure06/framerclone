import fs from "fs";
import path from "path";

function copyDir(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function extractBody(html: string): string {
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
}

function stripScriptTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

function extractExternalScriptSrcs(html: string): string[] {
  const srcs: string[] = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    srcs.push(m[1]);
  }
  return srcs;
}

function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const m of html.matchAll(
    /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const content = m[1].trim();
    if (content) scripts.push(content);
  }
  return scripts;
}

function extractTitle(html: string): string {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
}

function extractMetaDescription(html: string): string {
  return (
    html
      .match(
        /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
      )?.[1]
      ?.trim() ??
    html
      .match(
        /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i,
      )?.[1]
      ?.trim() ??
    ""
  );
}

function extractLinkTags(html: string): string[] {
  const tags: string[] = [];
  // keep font preconnects, preloads, icon, canonical — skip stylesheet (in combined.css)
  for (const m of html.matchAll(/<link[^>]*>/gi)) {
    const tag = m[0];
    if (
      /rel=["'](preconnect|dns-prefetch|preload|icon|shortcut icon|canonical)["']/i.test(
        tag,
      )
    ) {
      tags.push(tag.replace(/\s+/g, " ").trim());
    } else if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(tag)) {
      tags.push(tag.replace(/\s+/g, " ").trim());
    }
  }
  return tags;
}

function rewriteAssetUrls(
  html: string,
  assetMap: Record<string, string>,
): string {
  let result = html;
  // Sort keys by length descending to avoid partial matches
  const sortedKeys = Object.keys(assetMap).sort((a, b) => b.length - a.length);

  for (const absUrl of sortedKeys) {
    const relPath = assetMap[absUrl];
    // ./images/foo.png → /images/foo.png  (Next.js public folder)
    const publicPath = relPath.startsWith("./")
      ? relPath.slice(1)
      : `/${relPath}`;
    result = result.split(absUrl).join(publicPath);
  }
  return result;
}

function escapeTpl(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function toPascalCase(str: string): string {
  return (str || "index")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function slugifyName(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "framer-clone"
  );
}

function buildPageComponent(
  rawHtml: string,
  pageName: string,
  assetMap: Record<string, string>,
): string {
  const title = extractTitle(rawHtml);
  const description = extractMetaDescription(rawHtml);
  const linkTags = extractLinkTags(rawHtml);
  const externalScripts = extractExternalScriptSrcs(rawHtml);
  const inlineScripts = extractInlineScripts(rawHtml);

  let bodyHtml = extractBody(rawHtml);
  bodyHtml = stripScriptTags(bodyHtml);
  bodyHtml = rewriteAssetUrls(bodyHtml, assetMap);

  const componentName = toPascalCase(pageName);
  const safeTitle = title.replace(/[<>]/g, "");
  const safeDesc = description.replace(/"/g, "&quot;");

  const headLinks = linkTags
    .map((l) => rewriteAssetUrls(l, assetMap))
    .map((l) => `        ${l}`)
    .join("\n");

  const scriptLines = externalScripts
    .map((src) => {
      const local = assetMap[src]
        ? assetMap[src].startsWith("./")
          ? assetMap[src].slice(1)
          : `/${assetMap[src]}`
        : src;
      return `      <Script src=${JSON.stringify(local)} strategy="afterInteractive" />`;
    })
    .join("\n");

  const combinedInline = inlineScripts.join(";\n");
  const inlineBlock = combinedInline.trim()
    ? `      <Script id="${pageName}-init" strategy="afterInteractive">{${JSON.stringify(combinedInline)}}</Script>`
    : "";

  return `import parse from "html-react-parser";
import Head from "next/head";
import Script from "next/script";

const bodyHtml = \`${escapeTpl(bodyHtml)}\`;

export default function ${componentName}() {
  return (
    <>
      <Head>
        <title>${safeTitle}</title>
        ${safeDesc ? `<meta name="description" content="${safeDesc}" />` : ""}
${headLinks}
      </Head>
      {parse(bodyHtml)}
${scriptLines}
${inlineBlock}
    </>
  );
}
`;
}

export function scaffoldNextjs(input: {
  jobDir: string;
  siteTitle: string;
  siteUrl: string;
}): string {
  const { jobDir, siteTitle, siteUrl } = input;
  const outDir = path.join(jobDir, "_nextjs");

  const assetMap: Record<string, string> = fs.existsSync(
    path.join(jobDir, "asset-map.json"),
  )
    ? JSON.parse(fs.readFileSync(path.join(jobDir, "asset-map.json"), "utf-8"))
    : {};

  // directory structure
  for (const d of [
    "pages",
    "styles",
    "public/images",
    "public/scripts",
    "public/fonts",
  ]) {
    fs.mkdirSync(path.join(outDir, d), { recursive: true });
  }

  // copy images → public/images/
  copyDir(path.join(jobDir, "images"), path.join(outDir, "public/images"));
  // copy scripts → public/scripts/
  copyDir(path.join(jobDir, "scripts"), path.join(outDir, "public/scripts"));
  // copy fonts → public/fonts/
  copyDir(path.join(jobDir, "fonts"), path.join(outDir, "public/fonts"));

  // favicon
  for (const f of ["favicon.ico", "favicon.png", "favicon.svg"]) {
    const src = path.join(jobDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, "public", f));
      break;
    }
  }

  // CSS → styles/globals.css (rewrite relative image refs)
  const combinedCssPath = path.join(jobDir, "combined.css");
  let globalCss = "";
  if (fs.existsSync(combinedCssPath)) {
    globalCss = fs
      .readFileSync(combinedCssPath, "utf-8")
      // ./images/foo → /images/foo, etc.
      .replace(
        /url\(['"]?\.(\/(?:images|scripts|fonts)\/[^'")\s]+)['"]?\)/g,
        "url($1)",
      );
  }
  fs.writeFileSync(path.join(outDir, "styles/globals.css"), globalCss);

  // collect pages from pages/ dir
  const pagesDir = path.join(jobDir, "pages");
  const pageEntries: { name: string; htmlPath: string }[] = [];

  if (fs.existsSync(pagesDir)) {
    for (const f of fs.readdirSync(pagesDir)) {
      if (!f.endsWith(".html")) continue;
      pageEntries.push({
        name: f.replace(".html", ""),
        htmlPath: path.join(pagesDir, f),
      });
    }
  }

  // fallback to root index.html
  if (pageEntries.length === 0) {
    const rootIndex = path.join(jobDir, "index.html");
    if (fs.existsSync(rootIndex)) {
      pageEntries.push({ name: "index", htmlPath: rootIndex });
    }
  }

  for (const entry of pageEntries) {
    const rawHtml = fs.readFileSync(entry.htmlPath, "utf-8");
    const code = buildPageComponent(rawHtml, entry.name, assetMap);
    fs.writeFileSync(path.join(outDir, "pages", `${entry.name}.tsx`), code);
  }

  // _app.tsx
  fs.writeFileSync(
    path.join(outDir, "pages/_app.tsx"),
    `import type { AppProps } from "next/app";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
`,
  );

  // package.json
  fs.writeFileSync(
    path.join(outDir, "package.json"),
    JSON.stringify(
      {
        name: slugifyName(siteTitle),
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
        },
        dependencies: {
          next: "^14.2.0",
          react: "^18.3.0",
          "react-dom": "^18.3.0",
          "html-react-parser": "^5.1.0",
        },
        devDependencies: {
          typescript: "^5.4.0",
          "@types/react": "^18.3.0",
          "@types/react-dom": "^18.3.0",
          "@types/node": "^20.0.0",
        },
      },
      null,
      2,
    ),
  );

  // tsconfig.json
  fs.writeFileSync(
    path.join(outDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "es5",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: false,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
        },
        include: [
          "next-env.d.ts",
          "**/*.ts",
          "**/*.tsx",
          ".next/types/**/*.ts",
        ],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
  );

  // next.config.js
  fs.writeFileSync(
    path.join(outDir, "next.config.js"),
    `/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
};
module.exports = nextConfig;
`,
  );

  // .gitignore
  fs.writeFileSync(
    path.join(outDir, ".gitignore"),
    "node_modules\n.next\n.env\n",
  );

  // README.md
  fs.writeFileSync(
    path.join(outDir, "README.md"),
    `# ${siteTitle}

Cloned from [${siteUrl}](${siteUrl}) with SiteForge.

## Quick start

You can use the provided serve scripts to get started instantly:

### Windows
Double-click **\`_serve.bat\`**

### Mac / Linux
Run **\`./_serve.sh\`** in your terminal.

---

### Manual Setup
\`\`\`bash
npm install
npm run dev
\`\`\`

Open <http://localhost:3000> in your browser.

## Deploy

Push to GitHub and import in [Vercel](https://vercel.com) — it auto-detects Next.js.
`,
  );

  // _serve.bat (Windows)
  fs.writeFileSync(
    path.join(outDir, "_serve.bat"),
    "@echo off\necho Installing dependencies...\ncall npm install\necho Starting development server...\ncall npm run dev\npause",
  );

  // _serve.sh (Mac/Linux)
  fs.writeFileSync(
    path.join(outDir, "_serve.sh"),
    "#!/bin/bash\necho 'Installing dependencies...'\nnpm install\necho 'Starting development server...'\nnpm run dev",
  );
  try {
    fs.chmodSync(path.join(outDir, "_serve.sh"), 0o755);
  } catch {
    /* ignore */
  }

  return outDir;
}
