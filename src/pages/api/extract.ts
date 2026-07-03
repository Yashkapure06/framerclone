import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import { runScrapeJob } from "@/lib/extraction-pipeline";
import { assertFramerSite } from "@/lib/platform-detect";

function ndjsonLine(obj: Record<string, unknown>): string {
  return `${JSON.stringify(obj)}\n`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const remoteBase = process.env.EXTRACTOR_API_URL?.replace(/\/$/, "");
  if (process.env.VERCEL === "1" && remoteBase) {
    const target = `${remoteBase}/api/extract`;
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(req.body ?? {}),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upstream extract request failed";
      return res.status(502).json({ error: msg });
    }

    if (!upstream.ok) {
      const t = await upstream.text();
      return res.status(upstream.status).send(t);
    }

    res.status(200);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "no-store");

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.pipe(res);
    return;
  }

  const { url, removeWatermarks } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const write = (obj: Record<string, unknown>) => {
    res.write(ndjsonLine(obj));
  };

  try {
    await assertFramerSite(url);
    await runScrapeJob({ url, removeWatermarks }, write);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Extraction failed";
    if (!res.writableEnded) write({ type: "error", message });
  } finally {
    if (!res.writableEnded) res.end();
  }
}
