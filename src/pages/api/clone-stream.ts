import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { runScrapeJob } from "@/lib/extraction-pipeline";
import { assertFramerSite } from "@/lib/platform-detect";

const JOBS_DIR = path.join(process.cwd(), ".extractions");
const ZIPS_DIR = path.join(process.cwd(), ".extractions", "_zips");

function addDirToZip(zip: JSZip, srcDir: string, prefix: string) {
  if (!fs.existsSync(srcDir)) return;
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, ent.name);
    const dest = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) addDirToZip(zip, full, dest);
    else zip.file(dest, fs.readFileSync(full));
  }
}

function emit(res: NextApiResponse, data: Record<string, unknown>) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end();

  const { url, removeWatermarks = "true" } = req.query as Record<
    string,
    string
  >;

  if (!url) {
    res.status(400).end();
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    res.status(400).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const hostId = parsed.hostname.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const jobId = `${hostId}-${Date.now().toString().slice(-4)}`;
  const outputDir = path.join(JOBS_DIR, jobId);

  try {
    emit(res, { type: "status", message: `Checking ${parsed.hostname}…` });
    await assertFramerSite(parsed.toString());

    await runScrapeJob(
      { url: parsed.toString(), removeWatermarks: removeWatermarks === "true" },
      (event) => emit(res, event as unknown as Record<string, unknown>),
      outputDir,
    );

    emit(res, { type: "status", message: "Packaging ZIP…" });
    const zip = new JSZip();
    const standaloneDir = path.join(outputDir, "standalone");
    if (fs.existsSync(standaloneDir)) {
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
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    fs.mkdirSync(ZIPS_DIR, { recursive: true });
    const zipPath = path.join(ZIPS_DIR, `${jobId}.zip`);
    fs.writeFileSync(zipPath, buffer);

    // Auto-delete after 10 minutes
    setTimeout(
      () => {
        try {
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        } catch {
          /* expired */
        }
      },
      10 * 60 * 1000,
    );

    const sizeMb = (buffer.byteLength / 1024 / 1024).toFixed(1);
    const filename = `${hostId}.zip`;
    emit(res, { type: "ready", jobId, filename, sizeMb });
  } catch (err) {
    console.error("Stream clone failed:", err);
    emit(res, {
      type: "error",
      message: err instanceof Error ? err.message : "Extraction failed",
    });
  } finally {
    try {
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    } catch {
      /* cleanup */
    }
    if (!res.writableEnded) res.end();
  }
}

export const config = {
  api: { bodyParser: false, responseLimit: false },
};
