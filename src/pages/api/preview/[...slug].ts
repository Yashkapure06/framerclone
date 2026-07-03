import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

const MIME_MAP: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".ico": "image/x-icon",
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const slugParts = req.query.slug;
  if (!slugParts || !Array.isArray(slugParts) || slugParts.length < 1) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const [id, ...rest] = slugParts;
  const fileName = rest.length > 0 ? rest.join("/") : "index.html";
  const filePath = path.join(JOBS_DIR, id, fileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext] || "application/octet-stream";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=3600");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}
