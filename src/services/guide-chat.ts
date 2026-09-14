/**
 * Sphera chat service (D-029) — LangGraph turn execution with Neon-persisted
 * per-user thread memory. History is loaded server-side from guide_messages
 * (the client no longer sends it), streamed through the guide graph, and the
 * finished turn is written back — so the guide remembers across refreshes,
 * logins, and devices. Chat content is communication, never audited (same
 * stance as `messages`).
 */
import { and, asc, eq } from "drizzle-orm";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Db } from "@/db";
import { guideMessages } from "@/db/schema";
import type { Role } from "@/lib/rbac";
import { appCache } from "@/lib/ttl-cache";
import { buildGuideGraph } from "@/lib/guide/graph";
import {
  GREETING_REQUEST,
  MAX_HISTORY_TURNS,
  buildGuideSystemPrompt,
} from "@/lib/guide/prompt";

export class GuideChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuideChatError";
  }
}

/** one persisted conversation turn, oldest first */
export async function getThreadHistory(
  db: Db,
  userId: string,
  threadId: string,
) {
  return db
    .select({
      role: guideMessages.role,
      content: guideMessages.content,
      createdAt: guideMessages.createdAt,
    })
    .from(guideMessages)
    .where(
      and(
        eq(guideMessages.userId, userId),
        eq(guideMessages.threadId, threadId),
      ),
    )
    .orderBy(asc(guideMessages.createdAt));
}

export type GuideTurnInput = {
  userId: string;
  role: Role;
  userName: string;
  threadId: string;
  /** the user's message; omitted when greet is true */
  message?: string;
  greet?: boolean;
  /** injectable for tests; production passes ChatGroq from createGuideModel */
  model: BaseChatModel;
};

export type GuideTurnResult = {
  /** plain-text token stream for the widget */
  stream: ReadableStream<Uint8Array>;
  /** resolves with the full reply once the stream finishes (tests await it) */
  completion: Promise<string>;
  /** true when the reply was served from the response cache (no model call) */
  cached?: boolean;
};

/**
 * Reply cache (T6.10, D-030): ONLY empty-thread, non-greeting turns are
 * cacheable — with no history, the model's inputs are fully determined by
 * (role, userName, question), so serving the stored reply is equivalent.
 * Turns in a thread WITH history are never cached (memory must stay real),
 * and greetings are never cached (personalized rehydration moment).
 */
const REPLY_TTL_MS = 10 * 60_000;

export function guideReplyCacheKey(role: Role, userName: string, text: string): string {
  return `guide:${role}:${userName}:${text.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/**
 * Runs one guide turn: load thread memory → LangGraph (system prompt +
 * trimmed history + new message) → stream tokens → persist the turn.
 * Greetings persist only the assistant reply (the synthetic greeting request
 * is not part of the visible conversation).
 */
export async function runGuideTurn(
  db: Db,
  input: GuideTurnInput,
): Promise<GuideTurnResult> {
  const text = input.greet ? GREETING_REQUEST : input.message?.trim();
  if (!text) throw new GuideChatError("message is required");

  // server-side memory: the last N persisted turns of this user's thread
  const history = (
    await getThreadHistory(db, input.userId, input.threadId)
  ).slice(-MAX_HISTORY_TURNS);
  const lcHistory = history.map((t) =>
    t.role === "user" ? new HumanMessage(t.content) : new AIMessage(t.content),
  );

  // cache lookup — see guideReplyCacheKey's contract above
  const cacheable = !input.greet && history.length === 0 && text.length <= 200;
  const cacheKey = cacheable
    ? guideReplyCacheKey(input.role, input.userName, text)
    : null;
  if (cacheKey) {
    const hit = appCache.get(cacheKey) as string | undefined;
    if (hit) {
      // the turn is still persisted — memory stays real on cache hits
      const persist = db.insert(guideMessages).values([
        { userId: input.userId, threadId: input.threadId, role: "user" as const, content: text },
        { userId: input.userId, threadId: input.threadId, role: "assistant" as const, content: hit },
      ]);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(hit));
          await persist;
          controller.close();
        },
      });
      return { stream, completion: Promise.resolve(hit), cached: true };
    }
  }

  const graph = buildGuideGraph(input.model);
  const tokenStream = await graph.stream(
    { messages: [...lcHistory, new HumanMessage(text)] },
    {
      streamMode: "custom",
      configurable: {
        systemPrompt: buildGuideSystemPrompt({
          role: input.role,
          userName: input.userName,
        }),
      },
    },
  );

  const encoder = new TextEncoder();
  let resolveCompletion!: (full: string) => void;
  let rejectCompletion!: (err: unknown) => void;
  const completion = new Promise<string>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // callers may ignore completion (the route does) — never let a stream
  // error become an unhandled rejection
  completion.catch(() => {});

  // push-style stream (start + eager loop), then piped through an identity
  // TransformStream — the old pull()-based stream stalled ~30s on Vercel
  // (teammate finding, commit 774bf7b); both measures keep tokens flowing
  const raw = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of tokenStream) {
          const token = typeof chunk === "string" ? chunk : String(chunk ?? "");
          if (!token) continue;
          full += token;
          controller.enqueue(encoder.encode(token));
        }
        // persist the finished turn — memory survives the session
        if (full.trim()) {
          await db.insert(guideMessages).values([
            ...(!input.greet
              ? [
                  {
                    userId: input.userId,
                    threadId: input.threadId,
                    role: "user" as const,
                    content: text,
                  },
                ]
              : []),
            {
              userId: input.userId,
              threadId: input.threadId,
              role: "assistant" as const,
              content: full,
            },
          ]);
        }
        if (cacheKey && full.trim()) {
          appCache.set(cacheKey, full, REPLY_TTL_MS);
        }
        controller.close();
        resolveCompletion(full);
      } catch (err) {
        controller.error(err);
        rejectCompletion(err);
      }
    },
  });
  const stream = raw.pipeThrough(new TransformStream<Uint8Array, Uint8Array>());

  return { stream, completion };
}
