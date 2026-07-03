import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { generateTextWithFallback, type AiProviderId } from "@/lib/ai-provider";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

const bodySchema = z.object({
  id: z.string().min(1),
  framework: z.enum(["vanilla", "react", "nextjs"]),
  objective: z
    .enum(["upgrade", "refactor", "components", "landing", "full-build"])
    .optional(),
  prompt: z.string().min(1).optional(),
  provider: z
    .enum(["google", "openrouter", "groq", "github", "nvidia"])
    .optional(),
  model: z.string().min(1).optional(),
});

function extractBodyContent(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1]?.trim() || html;
}

function truncate(value: string, max = 12000): string {
  return value.length > max ? `${value.slice(0, max)}\n<!-- truncated -->` : value;
}

function loadJobContext(id: string) {
  const jobDir = path.join(JOBS_DIR, id);
  const manifestPath = path.join(jobDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Job not found");
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const pagesDir = path.join(jobDir, "pages");
  const pages: Array<{ slug: string; title: string; body: string }> = [];

  if (fs.existsSync(pagesDir)) {
    const files = fs.readdirSync(pagesDir).filter((file) => file.endsWith(".html"));
    for (const file of files.slice(0, 6)) {
      const html = fs.readFileSync(path.join(pagesDir, file), "utf-8");
      const slugName = file.replace(/\.html$/, "");
      const slug = slugName === "index" ? "/" : `/${slugName.replace(/--/g, "/")}`;
      pages.push({
        slug,
        title: file,
        body: truncate(extractBodyContent(html), 8000),
      });
    }
  } else {
    const indexPath = path.join(jobDir, "index.html");
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, "utf-8");
      pages.push({
        slug: "/",
        title: manifest.title || "Home",
        body: truncate(extractBodyContent(html), 8000),
      });
    }
  }

  const cssPath = path.join(jobDir, "combined.css");
  const css = fs.existsSync(cssPath)
    ? truncate(fs.readFileSync(cssPath, "utf-8"), 12000)
    : "";

  return { manifest, pages, css };
}

function buildObjectiveText(objective: string | undefined, framework: string) {
  switch (objective) {
    case "components":
      return `Turn extracted HTML into reusable ${framework} components with sensible file boundaries.`;
    case "landing":
      return `Improve marketing quality of extracted UI for ${framework} while preserving structure and visual intent.`;
    case "refactor":
      return `Refactor extracted output into cleaner production-ready ${framework} code without changing design.`;
    case "full-build":
      return `Generate a production-ready ${framework} codebase plan and starter code from extracted site data.`;
    default:
      return `Upgrade extracted output into stronger production-ready ${framework} code.`;
  }
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
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  try {
    const { manifest, pages, css } = loadJobContext(parsed.data.id);
    const objective = buildObjectiveText(parsed.data.objective, parsed.data.framework);

    const system = [
      "You are senior frontend engineer.",
      "Return concise, production-ready output.",
      "Preserve extracted UI intent.",
      "Prefer exact structure and realistic component boundaries.",
      "If code requested, return markdown with file blocks.",
    ].join(" ");

    const userPrompt = [
      `Goal: ${objective}`,
      parsed.data.prompt ? `Extra instruction: ${parsed.data.prompt}` : "",
      `Framework target: ${parsed.data.framework}`,
      `Site title: ${manifest.title || "Unknown"}`,
      `Source URL: ${manifest.url || ""}`,
      `Stats: ${manifest.pages || 0} pages, ${manifest.images || 0} images, ${manifest.stylesheets || 0} stylesheets, ${manifest.fonts || 0} fonts.`,
      "",
      "Manifest:",
      JSON.stringify(
        {
          title: manifest.title,
          description: manifest.description,
          platform: manifest.platform,
          crawledPages: manifest.crawledPages,
        },
        null,
        2,
      ),
      "",
      "Extracted pages:",
      pages
        .map(
          (page) =>
            `--- PAGE ${page.slug} ---\nTITLE: ${page.title}\n${page.body}`,
        )
        .join("\n\n"),
      "",
      "Combined CSS:",
      css || "No CSS extracted.",
      "",
      "Return:",
      "1. short architecture recommendation",
      "2. component/file plan",
      "3. starter implementation snippets",
      "4. risks/gaps to verify",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await generateTextWithFallback({
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      provider: parsed.data.provider as AiProviderId | undefined,
      model: parsed.data.model,
      temperature: 0.2,
      maxTokens: 4000,
    });

    return res.status(200).json({
      ok: true,
      provider: result.provider,
      model: result.model,
      objective: parsed.data.objective || "upgrade",
      framework: parsed.data.framework,
      text: result.text,
      tried: result.tried,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Framework build failed";
    const status = message === "Job not found" ? 404 : 502;
    return res.status(status).json({ error: message });
  }
}
