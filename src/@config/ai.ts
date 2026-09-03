import { z } from "zod";
import { handleConfigError } from "./errors";

export type AiProvider = "openai" | "gemini";

export interface AiProviderConfig {
  apiKey: string;
  apiEndpoint?: string;
  model?: string;
  provider: AiProvider;
  enabled: boolean;
  openaiEnabled: boolean;
}

export type ApiKeyMap = Record<AiProvider, AiProviderConfig>;

const aiConfigSchema = z
  .object({
    provider: z.enum(["openai", "gemini"]).default("gemini"),
    inferenceModel: z.string().default("gpt-4o-mini"),
    openApiEndpoint: z
      .string()
      .default("https://api.openai.com/v1/chat/completions"),
    openAIApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    geminiApiEndpoint: z
      .string()
      .default(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      ),
    geminiModel: z.string().default("gemini-2.0-flash"),
    enabled: z.boolean().default(true),
    openaiEnabled: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (
      data.enabled &&
      data.provider === "openai" &&
      data.openaiEnabled &&
      !data.openAIApiKey
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "OPENAI_API_KEY is required when AI_PROVIDER is 'openai' and OpenAI is enabled",
        path: ["openAIApiKey"],
      });
    }
    if (data.enabled && data.provider === "gemini" && !data.geminiApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "GEMINI_API_KEY is required when AI_PROVIDER is 'gemini' and AI is enabled",
        path: ["geminiApiKey"],
      });
    }
  });

export function isOpenAiEnabled(): boolean {
  if (
    process.env.OPENAI_ENABLED === "false" ||
    process.env.ENABLE_OPENAI === "false"
  ) {
    return false;
  }
  if (process.env.AI_ENABLED === "false") {
    return false;
  }
  return true;
}

export function isAiEnabled(): boolean {
  if (process.env.AI_ENABLED === "false") {
    return false;
  }
  return true;
}

const parseAiConfig = (): AiProviderConfig | undefined => {
  try {
    const provider = (process.env.AI_PROVIDER as AiProvider) || "openai";
    const openaiEnabled = isOpenAiEnabled();
    const overallAiEnabled =
      isAiEnabled() && (provider === "openai" ? openaiEnabled : true);

    const parsed = aiConfigSchema.parse({
      provider,
      openAIApiKey: process.env.OPENAI_API_KEY || "",
      openApiEndpoint: process.env.OPENAI_API_ENDPOINT,
      inferenceModel: process.env.OPENAI_API_MODEL || "gpt-4o-mini",
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      geminiApiEndpoint: process.env.GEMINI_API_ENDPOINT,
      geminiModel: process.env.GEMINI_API_MODEL || "gemini-2.0-flash",
      enabled: overallAiEnabled,
      openaiEnabled,
    });

    const config: ApiKeyMap = {
      openai: {
        apiKey: parsed.openAIApiKey || "",
        apiEndpoint: parsed.openApiEndpoint,
        provider: parsed.provider,
        model: parsed.inferenceModel,
        enabled: parsed.enabled && parsed.openaiEnabled,
        openaiEnabled: parsed.openaiEnabled,
      },
      gemini: {
        apiKey: parsed.geminiApiKey || "",
        apiEndpoint: parsed.geminiApiEndpoint,
        provider: parsed.provider,
        model: parsed.geminiModel,
        enabled: parsed.enabled,
        openaiEnabled: parsed.openaiEnabled,
      },
    };

    return config[provider];
  } catch (error) {
    handleConfigError("app", error);
  }
};

export const aiConfig = parseAiConfig();
