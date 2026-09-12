/**
 * Groq chat streaming via the OpenAI-compatible REST endpoint — plain fetch
 * and SSE parsing, no SDK (consistent with the fetch-based Gemini client).
 * The API key never leaves the server.
 */

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** exported for unit tests: extract content deltas from SSE lines */
export function parseSseLine(line: string): string | null {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as {
      choices?: { delta?: { content?: string } }[];
    };
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

export async function streamGroqChat({
  apiKey,
  model,
  messages,
  temperature = 0.5,
}: {
  apiKey: string;
  model: string;
  messages: GroqMessage[];
  temperature?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, temperature, stream: true, messages }),
  });

  if (!res.ok || !res.body) {
    let detail = `Groq request failed (${res.status})`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = err.error.message;
    } catch {
      /* keep status message */
    }
    throw new Error(detail);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const reader = res.body.getReader();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const delta = parseSseLine(line.trim());
        if (delta) controller.enqueue(encoder.encode(delta));
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}
