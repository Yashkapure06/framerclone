import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Job ID required" });

  const manifestPath = path.join(JOBS_DIR, id, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: "Job not found" });
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return res.status(200).json(manifest);
  } catch {
    return res.status(500).json({ error: "Failed to read job data" });
  }
}
