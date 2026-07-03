import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

export interface FileNode {
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
}

function slugToFileName(slug: string): string {
  if (slug === "/") return "index";
  return slug.replace(/^\//, "").replace(/\//g, "-");
}

function getCrawledPages(manifest: any): { slug: string; title: string }[] {
  if (manifest.crawledPages && manifest.crawledPages.length > 0) {
    return manifest.crawledPages.map((p: any) => ({ slug: p.slug, title: p.title }));
  }
  return [{ slug: "/", title: manifest.title || "Home" }];
}

function vanillaTree(manifest: any): FileNode[] {
  const pages = getCrawledPages(manifest);

  const htmlFiles: FileNode[] = pages.map((pg) => ({
    name: pg.slug === "/" ? "index.html" : slugToFileName(pg.slug) + ".html",
    type: "file" as const,
  }));

  return [
    { name: "package.json", type: "file" },
    { name: "README.md", type: "file" },
    { name: ".gitignore", type: "file" },
    {
      name: "metadata",
      type: "folder",
      children: [{ name: "extraction-summary.json", type: "file" }],
    },
    ...htmlFiles,
    {
      name: "css",
      type: "folder",
      children: [
        { name: "extracted-styles.css", type: "file" },
      ],
    },
    {
      name: "images",
      type: "folder",
      children: [{ name: "…", type: "file" }],
    },
  ];
}

function reactTree(manifest: any): FileNode[] {
  const pages = getCrawledPages(manifest);

  const pageFiles: FileNode[] = pages.map((pg) => ({
    name: slugToFileName(pg.slug) + ".tsx",
    type: "file" as const,
  }));

  return [
    { name: "package.json", type: "file" },
    { name: "vite.config.ts", type: "file" },
    { name: "tsconfig.json", type: "file" },
    { name: "tsconfig.node.json", type: "file" },
    { name: "README.md", type: "file" },
    { name: ".gitignore", type: "file" },
    { name: "index.html", type: "file" },
    {
      name: "metadata",
      type: "folder",
      children: [{ name: "extraction-summary.json", type: "file" }],
    },
    {
      name: "public",
      type: "folder",
      children: [
        { name: "favicon.ico", type: "file" },
        {
          name: "images",
          type: "folder",
          children: [{ name: "…", type: "file" }],
        },
      ],
    },
    {
      name: "src",
      type: "folder",
      children: [
        { name: "main.tsx", type: "file" },
        { name: "App.tsx", type: "file" },
        { name: "vite-env.d.ts", type: "file" },
        {
          name: "pages",
          type: "folder",
          children: pageFiles,
        },
        {
          name: "styles",
          type: "folder",
          children: [
            { name: "extracted.css", type: "file" },
          ],
        },
      ],
    },
  ];
}

function nextjsTree(manifest: any): FileNode[] {
  const pages = getCrawledPages(manifest);

  const routeNodes: FileNode[] = [];
  routeNodes.push({ name: "layout.tsx", type: "file" });
  routeNodes.push({ name: "globals.css", type: "file" });
  routeNodes.push({ name: "not-found.tsx", type: "file" });
  routeNodes.push({ name: "loading.tsx", type: "file" });

  for (const pg of pages) {
    if (pg.slug === "/") {
      routeNodes.push({ name: "page.tsx", type: "file" });
    } else {
      const routePath = pg.slug.replace(/^\//, "");
      const parts = routePath.split("/");
      let current = routeNodes;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        let folder = current.find((n) => n.name === part && n.type === "folder");
        if (!folder) {
          folder = { name: part, type: "folder", children: [] };
          current.push(folder);
        }
        current = folder.children!;
        if (i === parts.length - 1) {
          current.push({ name: "page.tsx", type: "file" });
        }
      }
    }
  }

  return [
    { name: "package.json", type: "file" },
    { name: "next.config.mjs", type: "file" },
    { name: "tsconfig.json", type: "file" },
    { name: "README.md", type: "file" },
    { name: ".gitignore", type: "file" },
    {
      name: "metadata",
      type: "folder",
      children: [{ name: "extraction-summary.json", type: "file" }],
    },
    {
      name: "public",
      type: "folder",
      children: [
        { name: "favicon.ico", type: "file" },
        { name: "robots.txt", type: "file" },
        {
          name: "images",
          type: "folder",
          children: [{ name: "…", type: "file" }],
        },
      ],
    },
    {
      name: "src",
      type: "folder",
      children: [
        {
          name: "app",
          type: "folder",
          children: routeNodes,
        },
        {
          name: "styles",
          type: "folder",
          children: [
            { name: "extracted.css", type: "file" },
          ],
        },
      ],
    },
  ];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const { id, framework } = req.query;
  if (!id || typeof id !== "string")
    return res.status(400).json({ error: "Job ID required" });

  const manifestPath = path.join(JOBS_DIR, id, "manifest.json");
  if (!fs.existsSync(manifestPath))
    return res.status(404).json({ error: "Job not found" });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const fw = (typeof framework === "string" ? framework : "vanilla").toLowerCase();

  let tree: FileNode[];
  switch (fw) {
    case "react":
      tree = reactTree(manifest);
      break;
    case "nextjs":
      tree = nextjsTree(manifest);
      break;
    default:
      tree = vanillaTree(manifest);
      break;
  }

  return res.status(200).json({ framework: fw, tree });
}
