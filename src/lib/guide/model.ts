/**
 * Sphera's chat model — ChatGroq from the guide config (Settings row first,
 * env fallback; see getGuideConfig). Hard 20s timeout so a hung upstream
 * surfaces as a readable error instead of riding into a platform 504;
 * gpt-oss models keep their silent "thinking" phase short.
 */
import { ChatGroq } from "@langchain/groq";
import type { GuideConfig } from "@/services/settings";

export function createGuideModel(cfg: GuideConfig): ChatGroq {
  return new ChatGroq({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: 0.5,
    streaming: true,
    maxRetries: 1,
    timeout: 20_000,
    ...(cfg.model.includes("gpt-oss") ? { reasoningEffort: "low" as const } : {}),
  });
}
