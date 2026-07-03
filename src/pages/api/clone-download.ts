import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";

const ZIPS_DIR = path.join(process.cwd(), ".extractions", "_zips");

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const { jobId, filename = "framer-clone.zip" } = req.query as Record<string, string>;
  if (!jobId || !/^[a-z0-9-]+$/i.test(jobId)) return res.status(400).json({ error: "jobId required" });

  const zipPath = path.join(ZIPS_DIR, `${jobId}.zip`);
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: "Download expired. Clone again." });
  }

  const buffer = fs.readFileSync(zipPath);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.status(200).send(buffer);

  // Cleanup after serving
  try { fs.unlinkSync(zipPath); } catch { /* best-effort */ }
}

export const config = {
  api: { responseLimit: "100mb" },
};
