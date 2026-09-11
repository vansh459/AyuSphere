/** Claude text client for the Copilot (D-005). */
import Anthropic from "@anthropic-ai/sdk";
import type { TextClient } from "@/services/copilot";

export function createClaudeTextClient(): TextClient {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  return {
    modelId: model,
    async complete(prompt: string) {
      const msg = await client.messages.create({
        model,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });
      return msg.content.find((b) => b.type === "text")?.text ?? "";
    },
  };
}
