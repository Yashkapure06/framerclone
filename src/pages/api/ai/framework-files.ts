import type { NextApiRequest, NextApiResponse } from "next";
import JSZip from "jszip";
import { z } from "zod";
import { type AiProviderId } from "@/lib/ai-provider";
import {
  formatAiStarterFile,
  generateAiStarterPack,
} from "@/lib/ai-starter-pack";

const bodySchema = z.object({
  id: z.string().min(1),
  framework: z.enum(["vanilla", "react", "nextjs"]),
  provider: z
    .enum(["google", "openrouter", "groq", "github", "nvidia"])
    .optional(),
  model: z.string().min(1).optional(),
});

function safeFileName(name: string) {
  return (name || "extracted-site")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
  }

  try {
    const pack = await generateAiStarterPack({
      id: parsed.data.id,
      framework: parsed.data.framework,
      provider: parsed.data.provider as AiProviderId | undefined,
      model: parsed.data.model,
    });
    const zip = new JSZip();
    const prefix = `${safeFileName(parsed.data.id)}-${parsed.data.framework}-ai-starter`;

    for (const file of pack.files) {
      zip.file(
        `${prefix}/${file.path}`,
        await formatAiStarterFile(file.content, file.path),
      );
    }

    zip.file(
      `${prefix}/AI_STARTER_SUMMARY.md`,
      [
        `# AI Starter Pack`,
        "",
        `Framework: ${parsed.data.framework}`,
        `Provider: ${pack.provider}`,
        `Model: ${pack.model}`,
        "",
        pack.summary,
        "",
        "## Files",
        ...pack.files.map((file) => `- \`${file.path}\`${file.purpose ? `: ${file.purpose}` : ""}`),
      ].join("\n"),
    );

    zip.file(
      `${prefix}/metadata/ai-response.json`,
      JSON.stringify(
        {
          provider: pack.provider,
          model: pack.model,
          tried: pack.tried,
          summary: pack.summary,
          files: pack.files.map((file) => ({ path: file.path, purpose: file.purpose || "" })),
        },
        null,
        2,
      ),
    );

    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${prefix}.zip"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI starter pack failed";
    return res.status(message === "Job not found" ? 404 : 502).json({ error: message });
  }
}
