import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { runScrapeJob } from "@/lib/extraction-pipeline";
import { assertFramerSite } from "@/lib/platform-detect";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

function addDirToZip(zip: JSZip, srcDir: string, prefix: string) {
  if (!fs.existsSync(srcDir)) return;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, ent.name);
    const dest = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) addDirToZip(zip, full, dest);
    else zip.file(dest, fs.readFileSync(full));
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { url, removeWatermarks = true } = req.body as {
    url?: string;
    removeWatermarks?: boolean;
  };

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL required" });
  }

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // Create a clean job ID based on the hostname
  const hostId = parsed.hostname.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const jobId = `${hostId}-${Date.now().toString().slice(-4)}`;
  const outputDir = path.join(JOBS_DIR, jobId);

  try {
    await assertFramerSite(parsed.toString());

    // Use the modern, flat, portable-enabled pipeline
    await runScrapeJob(
      {
        url: parsed.toString(),
        removeWatermarks: removeWatermarks !== false,
      },
      () => {},
      outputDir,
    );

    const zip = new JSZip();
    const standaloneDir = path.join(outputDir, "standalone");
    if (fs.existsSync(path.join(standaloneDir, "index.html"))) {
      // Tidy user-facing bundle: self-contained HTML + media, no build artifacts
      addDirToZip(zip, standaloneDir, "");
      addDirToZip(zip, path.join(outputDir, "images"), "images");
      addDirToZip(zip, path.join(outputDir, "fonts"), "fonts");
      for (const f of fs.readdirSync(outputDir)) {
        if (/^favicon\./i.test(f))
          zip.file(f, fs.readFileSync(path.join(outputDir, f)));
      }
      zip.file(
        "README.md",
        `# ${parsed.hostname}\n\nCloned from ${parsed.toString()}.\n\nOpen \`index.html\` directly in your browser - every page is self-contained (CSS and JavaScript inlined).\nFor best results serve the folder over HTTP: \`npx serve .\`\n`,
      );
    } else {
      addDirToZip(zip, outputDir, "");
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${hostId}.zip"`,
    );
    return res.status(200).send(zipBuffer);
  } catch (err) {
    console.error("Clone failed:", err);
    const message = err instanceof Error ? err.message : "Clone failed";
    if (!res.headersSent) return res.status(500).json({ error: message });
  } finally {
    // Note: In production you might want to delay cleanup or use a separate cron
    try {
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    } catch {
      /* cleanup best-effort */
    }
  }
}

export const config = {
  api: {
    responseLimit: "100mb",
    bodyParser: { sizeLimit: "1mb" },
  },
};
