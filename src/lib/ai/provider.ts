/**
 * AI provider resolution — UI-configured settings (app_settings table) win;
 * environment variables are the fallback. Supported: Anthropic Claude and
 * Google Gemini, both behind the same client interfaces.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";
import type { VisionClient } from "@/lib/ai/types";
import type { TextClient } from "@/services/copilot";
import { createClaudeVisionClient } from "@/lib/ai/claude";
import { createClaudeTextClient } from "@/lib/ai/claude-text";
import {
  GEMINI_DEFAULT_MODEL,
  createGeminiTextClient,
  createGeminiVisionClient,
} from "@/lib/ai/gemini";

export const AI_SETTINGS_KEY = "ai";
export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5";

export const aiConfigSchema = z.object({
  provider: z.enum(["anthropic", "gemini"]),
  model: z.string().min(1),
  apiKey: z.string().min(8),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;
export type AiProvider = AiConfig["provider"];

export function defaultModelFor(provider: AiProvider): string {
  return provider === "gemini" ? GEMINI_DEFAULT_MODEL : CLAUDE_DEFAULT_MODEL;
}

/** settings row first, env fallback second, null when nothing is configured */
export async function getAiConfig(db: Db): Promise<AiConfig | null> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, AI_SETTINGS_KEY))
      .limit(1);
    if (row) {
      const parsed = aiConfigSchema.safeParse(row.value);
      if (parsed.success) return parsed.data;
    }
  } catch {
    // settings table unreachable → fall through to env
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      model: process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
      apiKey: process.env.GEMINI_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? CLAUDE_DEFAULT_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  return null;
}

export function createVisionClientFor(cfg: AiConfig): VisionClient {
  return cfg.provider === "gemini"
    ? createGeminiVisionClient(cfg)
    : createClaudeVisionClient(cfg);
}

export function createTextClientFor(cfg: AiConfig): TextClient {
  return cfg.provider === "gemini"
    ? createGeminiTextClient(cfg)
    : createClaudeTextClient(cfg);
}

export const NO_AI_MESSAGE =
  "No AI provider configured — an administrator can add a Gemini or Anthropic API key under Settings → AI Model.";
