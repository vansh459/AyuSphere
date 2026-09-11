/** Claude text client for the Copilot — provider-selected in @/lib/ai/provider. */
import Anthropic from "@anthropic-ai/sdk";
import type { TextClient } from "@/services/copilot";

export function createClaudeTextClient(cfg: {
  apiKey: string;
  model: string;
}): TextClient {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  return {
    modelId: cfg.model,
    async complete(prompt: string) {
      const msg = await client.messages.create({
        model: cfg.model,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });
      return msg.content.find((b) => b.type === "text")?.text ?? "";
    },
  };
}
