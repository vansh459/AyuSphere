/**
 * Sphera's LangGraph (D-029) — a StateGraph over MessagesAnnotation with a
 * single respond node. The system prompt travels through configurable (so
 * the graph stays pure), tokens are emitted through the "custom" stream
 * writer (works with ANY BaseChatModel — real ChatGroq streams token by
 * token, test fakes emit one chunk), and the aggregated reply lands back in
 * graph state.
 */
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { MessageContent } from "@langchain/core/messages";

/** flatten LangChain message content (string or content-block array) to text */
export function contentToText(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      const b = block as { type?: string; text?: unknown };
      return b.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .join("");
}

export function buildGuideGraph(model: BaseChatModel) {
  const respond = async (
    state: typeof MessagesAnnotation.State,
    config: LangGraphRunnableConfig,
  ) => {
    const systemPrompt = String(config.configurable?.systemPrompt ?? "");
    const stream = await model.stream([
      new SystemMessage(systemPrompt),
      ...state.messages,
    ]);
    let full = "";
    for await (const chunk of stream) {
      const text = contentToText(chunk.content);
      if (text) {
        full += text;
        config.writer?.(text);
      }
    }
    return { messages: [new AIMessage(full)] };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("respond", respond)
    .addEdge(START, "respond")
    .addEdge("respond", END)
    .compile();
}
