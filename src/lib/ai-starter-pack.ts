import fs from "fs";
import path from "path";
import prettier from "prettier";
import { generateTextWithFallback, type AiProviderId } from "@/lib/ai-provider";

const JOBS_DIR = path.join(process.cwd(), ".extractions");

export interface AiStarterFile {
  path: string;
  purpose: string;
  content: string;
}

export interface AiStarterPackResult {
  summary: string;
  provider: string;
  model: string;
  tried: Array<{ provider: string; ok: boolean; error?: string }>;
  files: AiStarterFile[];
}

function extractBodyContent(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return match?.[1]?.trim() || html;
}

function truncate(value: string, max = 6000): string {
  return value.length > max ? `${value.slice(0, max)}\n<!-- truncated -->` : value;
}

function loadJobContext(id: string) {
  const jobDir = path.join(JOBS_DIR, id);
  const manifestPath = path.join(jobDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Job not found");

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
        body: truncate(extractBodyContent(html), 3000),
      });
    }
  }

  const cssPath = path.join(jobDir, "combined.css");
  const css = fs.existsSync(cssPath)
    ? truncate(fs.readFileSync(cssPath, "utf-8"), 5000)
    : "";

  return { manifest, pages, css };
}

function buildPrompt(
  framework: string,
  manifest: any,
  pages: Array<{ slug: string; title: string; body: string }>,
  css: string,
) {
  return [
    `Framework target: ${framework}`,
    "Return strict JSON only.",
    "Build compact starter pack that improves extracted site toward production-ready code.",
    "",
    "Required schema:",
    JSON.stringify(
      {
        summary: "short summary",
        files: [
          {
            path: "src/example.tsx",
            purpose: "why this file exists",
            content: "full file content",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Rules:",
    "- 2 to 4 files maximum",
    "- no markdown fences",
    "- keep each file concise — scaffold and structure, not exhaustive implementation",
    "- prefer: one shared layout/component, one types file, one page file, one CSS/config file",
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
    "Pages:",
    pages.map((page) => `--- ${page.slug} ---\nTITLE: ${page.title}\n${page.body}`).join("\n\n"),
    "",
    "Combined CSS:",
    css || "No CSS extracted.",
  ].join("\n");
}

/**
 * Walk raw JSON char-by-char tracking string/escape state, extract all
 * complete file objects before any truncation point, and rebuild valid JSON.
 * Handles truncation at ANY position — including mid-string in `content`.
 */
function repairTruncatedJson(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch { /* fall through */ }

  // Pull summary if present
  const summaryMatch = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const summary = summaryMatch ? summaryMatch[1] : "AI starter files (partial — response was truncated)";

  // Locate start of files array
  const filesKey = raw.indexOf('"files"');
  if (filesKey === -1) return JSON.stringify({ summary, files: [] });
  const arrayOpen = raw.indexOf("[", filesKey);
  if (arrayOpen === -1) return JSON.stringify({ summary, files: [] });

  const completeFiles: Array<{ path: string; purpose: string; content: string }> = [];
  let pos = arrayOpen + 1;

  while (pos < raw.length) {
    // Skip whitespace and commas between entries
    while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\n" || raw[pos] === "\r" || raw[pos] === "\t" || raw[pos] === ",")) {
      pos++;
    }
    if (pos >= raw.length) break;
    if (raw[pos] === "]") break; // clean end of array
    if (raw[pos] !== "{") { pos++; continue; }

    // Find the matching closing brace using char-level state machine
    let depth = 0;
    let inString = false;
    let escaped = false;
    let objEnd = -1;

    for (let j = pos; j < raw.length; j++) {
      const c = raw[j];
      if (escaped) { escaped = false; continue; }
      if (c === "\\" && inString) { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") { depth++; continue; }
      if (c === "}") {
        depth--;
        if (depth === 0) { objEnd = j; break; }
      }
    }

    if (objEnd === -1) break; // Truncated inside this object — stop, keep what we have

    const objStr = raw.slice(pos, objEnd + 1);
    try {
      const obj = JSON.parse(objStr) as Record<string, unknown>;
      if (typeof obj.path === "string" && typeof obj.content === "string") {
        completeFiles.push({
          path: obj.path,
          purpose: typeof obj.purpose === "string" ? obj.purpose : "",
          content: obj.content,
        });
      }
    } catch { /* object not valid JSON — skip */ }

    pos = objEnd + 1;
  }

  return JSON.stringify({ summary, files: completeFiles });
}

function extractJsonPayload(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return repairTruncatedJson(fenced[1].trim());
  const firstBrace = text.indexOf("{");
  if (firstBrace >= 0) {
    const lastBrace = text.lastIndexOf("}");
    const slice = lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : text.slice(firstBrace);
    return repairTruncatedJson(slice);
  }
  return repairTruncatedJson(text.trim());
}

export async function formatAiStarterFile(content: string, filepath: string): Promise<string> {
  try {
    return await prettier.format(content, {
      filepath,
      semi: true,
      singleQuote: true,
      trailingComma: "es5",
      printWidth: 100,
    });
  } catch {
    return content;
  }
}

export async function generateAiStarterPack(args: {
  id: string;
  framework: "vanilla" | "react" | "nextjs";
  provider?: AiProviderId;
  model?: string;
}): Promise<AiStarterPackResult> {
  const { manifest, pages, css } = loadJobContext(args.id);

  const result = await generateTextWithFallback({
    messages: [
      {
        role: "system",
        content:
          "You are senior frontend engineer. Return JSON only. Produce complete starter files.",
      },
      {
        role: "user",
        content: buildPrompt(args.framework, manifest, pages, css),
      },
    ],
    provider: args.provider,
    model: args.model,
    temperature: 0.2,
    maxTokens: 10000,
  });

  const payload = JSON.parse(extractJsonPayload(result.text)) as {
    summary?: string;
    files?: Array<{ path?: string; purpose?: string; content?: string }>;
  };

  const files = (payload.files || [])
    .filter((file): file is { path: string; purpose?: string; content: string } => !!file.path && !!file.content)
    .slice(0, 12)
    .map((file) => ({
      path: file.path,
      purpose: file.purpose || "",
      content: file.content,
    }));

  if (files.length === 0) throw new Error("AI returned no usable files. The response may have been too long — try again or switch to a different AI provider.");

  return {
    summary: payload.summary || "AI starter files generated from extracted site data.",
    provider: result.provider,
    model: result.model,
    tried: result.tried,
    files,
  };
}
