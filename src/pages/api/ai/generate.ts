import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import {
  type AiMessage,
  type AiProviderId,
  generateTextWithFallback,
  listConfiguredAiProviders,
} from "@/lib/ai-provider";

const bodySchema = z.object({
  prompt: z.string().min(1),
  system: z.string().optional(),
  provider: z
    .enum(["google", "openrouter", "groq", "github", "nvidia"])
    .optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(16000).optional(),
});

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
    const messages: AiMessage[] = [];
    if (parsed.data.system) {
      messages.push({ role: "system", content: parsed.data.system });
    }
    messages.push({ role: "user", content: parsed.data.prompt });

    const result = await generateTextWithFallback({
      messages,
      provider: parsed.data.provider as AiProviderId | undefined,
      model: parsed.data.model,
      temperature: parsed.data.temperature,
      maxTokens: parsed.data.maxTokens,
    });

    return res.status(200).json({
      ok: true,
      provider: result.provider,
      model: result.model,
      text: result.text,
      tried: result.tried,
      configuredProviders: listConfiguredAiProviders(),
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "AI generation failed",
      configuredProviders: listConfiguredAiProviders(),
    });
  }
}
