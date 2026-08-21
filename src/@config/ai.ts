import { z } from "zod";
import { handleConfigError } from "./errors";

type AiProvider = "openai" | "gemini";

type ApiKeyMap = Record<
  AiProvider,
  {
    apiKey: string;
    apiEndpoint?: string;
    model?: string;
    provider: AiProvider;
  }
>;

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
    geminiModel: z.string().default("gemini-1.5-flash"),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "openai" && !data.openAIApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OPENAI_API_KEY is required when AI_PROVIDER is 'openai'",
        path: ["openAIApiKey"],
      });
    }
    if (data.provider === "gemini" && !data.geminiApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GEMINI_API_KEY is required when AI_PROVIDER is 'gemini'",
        path: ["geminiApiKey"],
      });
    }
  });

const parseAiConfig = () => {
  try {
    const provider = (process.env.AI_PROVIDER as AiProvider) || "openai";
    const parsed = aiConfigSchema.parse({
      provider,
      openAIApiKey: process.env.OPENAI_API_KEY || "",
      openApiEndpoint: process.env.OPENAI_API_ENDPOINT,
      inferenceModel: process.env.OPENAI_API_MODEL || "gpt-4o-mini",
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      geminiApiEndpoint: process.env.GEMINI_API_ENDPOINT,
      geminiModel: process.env.GEMINI_API_MODEL || "gemini-1.5-flash",
    });

    const config: ApiKeyMap = {
      openai: {
        apiKey: parsed.openAIApiKey!,
        apiEndpoint: parsed.openApiEndpoint,
        provider: parsed.provider,
        model: parsed.inferenceModel,
      },
      gemini: {
        apiKey: parsed.geminiApiKey!,
        apiEndpoint: parsed.geminiApiEndpoint,
        provider: parsed.provider,
        model: parsed.geminiModel,
      },
    };

    return config[provider];
  } catch (error) {
    handleConfigError("app", error);
  }
};

export const aiConfig = parseAiConfig();
