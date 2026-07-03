export type AiProviderId =
  | "google"
  | "openrouter"
  | "groq"
  | "github"
  | "nvidia";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateTextInput {
  messages: AiMessage[];
  provider?: AiProviderId;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateTextSuccess {
  provider: AiProviderId;
  model: string;
  text: string;
  tried: Array<{ provider: AiProviderId; ok: boolean; error?: string }>;
}

interface ProviderRuntime {
  id: AiProviderId;
  model: string;
}

const DEFAULT_PROVIDER_ORDER: AiProviderId[] = [
  "openrouter",
  "google",
  "groq",
  "github",
  "nvidia",
];

function splitCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isProviderId(value: string): value is AiProviderId {
  return DEFAULT_PROVIDER_ORDER.includes(value as AiProviderId);
}

function parseProviderOrder(): AiProviderId[] {
  const fromEnv = splitCsv(process.env.AI_PROVIDER_ORDER);
  const valid = fromEnv.filter(isProviderId);
  return valid.length > 0 ? valid : DEFAULT_PROVIDER_ORDER;
}

function getGoogleApiKey(): string {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
}

function getProviderModel(id: AiProviderId): string | null {
  switch (id) {
    case "google":
      return process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash";
    case "openrouter":
      return process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";
    case "groq":
      return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    case "github":
      return process.env.GITHUB_MODELS_MODEL || "openai/gpt-4.1-mini";
    case "nvidia":
      return process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v4-flash";
    default:
      return null;
  }
}

function hasProviderConfig(id: AiProviderId): boolean {
  switch (id) {
    case "google":
      return !!getGoogleApiKey();
    case "openrouter":
      return !!process.env.OPENROUTER_API_KEY;
    case "groq":
      return !!process.env.GROQ_API_KEY;
    case "github":
      return !!process.env.GITHUB_MODELS_TOKEN;
    case "nvidia":
      return !!process.env.NVIDIA_API_KEY;
    default:
      return false;
  }
}

function resolveProviders(preferred?: AiProviderId): ProviderRuntime[] {
  const ordered = preferred ? [preferred] : parseProviderOrder();
  return ordered
    .filter((id, index) => ordered.indexOf(id) === index)
    .filter((id) => hasProviderConfig(id))
    .map((id) => ({ id, model: getProviderModel(id) || "" }))
    .filter((provider) => !!provider.model);
}

function normalizeOpenAiText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `HTTP ${response.status}`;
  try {
    const json = JSON.parse(text);
    return (
      json?.error?.message ||
      json?.error ||
      json?.errors?.[0]?.message ||
      json?.message ||
      `HTTP ${response.status}`
    );
  } catch {
    return text.slice(0, 300);
  }
}

async function requestOpenAiCompatible(
  endpoint: string,
  headers: Record<string, string>,
  model: string,
  input: GenerateTextInput,
): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 4000,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = await response.json();
  const text = normalizeOpenAiText(payload);
  if (!text) throw new Error("Provider returned empty response");
  return text;
}

async function requestGoogle(model: string, input: GenerateTextInput): Promise<string> {
  const apiKey = getGoogleApiKey();
  const systemMessage = input.messages.find((message) => message.role === "system");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey || "")}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: systemMessage
          ? {
              parts: [{ text: systemMessage.content }],
            }
          : undefined,
        contents: input.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
        generationConfig: {
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxTokens ?? 4000,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = await response.json();
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (!text) throw new Error("Provider returned empty response");
  return text;
}

async function requestByProvider(
  runtime: ProviderRuntime,
  input: GenerateTextInput,
): Promise<string> {
  const overrideModel = input.model || runtime.model;

  switch (runtime.id) {
    case "google":
      return requestGoogle(overrideModel, input);
    case "openrouter":
      return requestOpenAiCompatible(
        process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1/chat/completions",
        {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          ...(process.env.OPENROUTER_SITE_URL
            ? { "HTTP-Referer": process.env.OPENROUTER_SITE_URL }
            : {}),
          ...(process.env.OPENROUTER_SITE_NAME
            ? { "X-Title": process.env.OPENROUTER_SITE_NAME }
            : {}),
        },
        overrideModel,
        input,
      );
    case "groq":
      return requestOpenAiCompatible(
        process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1/chat/completions",
        {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        overrideModel,
        input,
      );
    case "github":
      return requestOpenAiCompatible(
        process.env.GITHUB_MODELS_BASE_URL || "https://models.github.ai/inference/chat/completions",
        {
          Authorization: `Bearer ${process.env.GITHUB_MODELS_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version":
            process.env.GITHUB_MODELS_API_VERSION || "2026-03-10",
        },
        overrideModel,
        input,
      );
    case "nvidia":
      return requestOpenAiCompatible(
        process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        },
        overrideModel,
        input,
      );
    default:
      throw new Error(`Unsupported provider: ${runtime.id}`);
  }
}

export function listConfiguredAiProviders() {
  return resolveProviders().map((provider) => ({
    id: provider.id,
    model: provider.model,
  }));
}

export async function generateTextWithFallback(
  input: GenerateTextInput,
): Promise<GenerateTextSuccess> {
  const providers = resolveProviders(input.provider);
  if (providers.length === 0) {
    throw new Error("No AI providers configured. Add keys in .env.local.");
  }

  const tried: GenerateTextSuccess["tried"] = [];

  for (const provider of providers) {
    try {
      const text = await requestByProvider(provider, input);
      tried.push({ provider: provider.id, ok: true });
      return {
        provider: provider.id,
        model: input.model || provider.model,
        text,
        tried,
      };
    } catch (error) {
      tried.push({
        provider: provider.id,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown provider error",
      });
    }
  }

  const last = tried[tried.length - 1];
  throw new Error(last?.error || "All AI providers failed");
}
