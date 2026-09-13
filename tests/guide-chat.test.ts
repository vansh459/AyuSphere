/**
 * Sphera v2 (D-029) — LangGraph turn execution with persistent thread memory.
 * Gate: a turn streams the model reply and persists user+assistant rows; the
 * SECOND turn's model input contains the first turn (memory proven by
 * capturing what the model receives); greetings persist only the reply;
 * threads are isolated per user and per threadId; history is trimmed to
 * MAX_HISTORY_TURNS; the system prompt carries the role slice.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { BaseMessage } from "@langchain/core/messages";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { createTestDb, type TestDb } from "./helpers/db";
import { guideMessages, users } from "@/db/schema";
import { contentToText } from "@/lib/guide/graph";
import { GREETING_REQUEST, MAX_HISTORY_TURNS } from "@/lib/guide/prompt";
import {
  GuideChatError,
  getThreadHistory,
  runGuideTurn,
} from "@/services/guide-chat";

/** fake streaming model that records every message list it receives */
class CapturingModel extends FakeListChatModel {
  received: BaseMessage[][] = [];

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ) {
    this.received.push(messages);
    yield* super._streamResponseChunks(messages, options, runManager);
  }
}

const texts = (msgs: BaseMessage[]) => msgs.map((m) => contentToText(m.content));

let db: TestDb;
let userId: string;

beforeAll(async () => {
  db = await createTestDb();
  const [u] = await db
    .insert(users)
    .values([{ email: "pi@sph.demo", passwordHash: "x", name: "Dr. Ananya", role: "pi" }])
    .returning();
  userId = u.id;
});

describe("Sphera v2 — turn execution + persistence", () => {
  it("streams the reply and persists both sides of the turn", async () => {
    const model = new CapturingModel({ responses: ["Go to **Participants**."] });
    const { stream, completion } = await runGuideTurn(db, {
      userId,
      role: "pi",
      userName: "Dr. Ananya",
      threadId: "t-main",
      message: "How do I enrol someone?",
      model,
    });

    const streamed = await new Response(stream).text();
    expect(streamed).toBe("Go to **Participants**.");
    expect(await completion).toBe("Go to **Participants**.");

    const history = await getThreadHistory(db, userId, "t-main");
    expect(history.map((h) => [h.role, h.content])).toEqual([
      ["user", "How do I enrol someone?"],
      ["assistant", "Go to **Participants**."],
    ]);

    // the model saw the role-sliced system prompt + the new message
    const [received] = model.received;
    expect(texts(received)[0]).toContain("Principal Investigator");
    expect(texts(received)[0]).toContain("Never expose internal details");
    expect(texts(received).at(-1)).toBe("How do I enrol someone?");
  });

  it("MEMORY: the second turn's model input contains the first turn", async () => {
    const model = new CapturingModel({ responses: ["Then click **Enrol & randomize**."] });
    const { stream, completion } = await runGuideTurn(db, {
      userId,
      role: "pi",
      userName: "Dr. Ananya",
      threadId: "t-main",
      message: "and after consent?",
      model,
    });
    await new Response(stream).text();
    await completion;

    const [received] = model.received;
    const contents = texts(received);
    // system + first user + first assistant + new user
    expect(contents).toContain("How do I enrol someone?");
    expect(contents).toContain("Go to **Participants**.");
    expect(contents.at(-1)).toBe("and after consent?");

    const history = await getThreadHistory(db, userId, "t-main");
    expect(history).toHaveLength(4);
  });

  it("greetings persist ONLY the assistant reply (synthetic request hidden)", async () => {
    const model = new CapturingModel({ responses: ["Hi Dr. Ananya! I can help with…"] });
    const { stream, completion } = await runGuideTurn(db, {
      userId,
      role: "pi",
      userName: "Dr. Ananya",
      threadId: "t-greet",
      greet: true,
      model,
    });
    await new Response(stream).text();
    await completion;

    // the model DID receive the greeting request…
    expect(texts(model.received[0]).at(-1)).toBe(GREETING_REQUEST);
    // …but only the reply is stored
    const history = await getThreadHistory(db, userId, "t-greet");
    expect(history.map((h) => h.role)).toEqual(["assistant"]);
  });

  it("threads are isolated per threadId and per user", async () => {
    const [other] = await db
      .insert(users)
      .values([{ email: "co@sph.demo", passwordHash: "x", name: "Ravi", role: "coordinator" }])
      .returning();
    expect(await getThreadHistory(db, userId, "t-elsewhere")).toHaveLength(0);
    expect(await getThreadHistory(db, other.id, "t-main")).toHaveLength(0);
    // and the real thread is untouched
    expect((await getThreadHistory(db, userId, "t-main")).length).toBeGreaterThan(0);
  });

  it(`history sent to the model is trimmed to the last ${MAX_HISTORY_TURNS} turns`, async () => {
    await db.insert(guideMessages).values(
      Array.from({ length: 12 }, (_, i) => ({
        userId,
        threadId: "t-long",
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `t${i}`,
        createdAt: new Date(Date.now() - (12 - i) * 1000),
      })),
    );
    const model = new CapturingModel({ responses: ["ok"] });
    const { stream, completion } = await runGuideTurn(db, {
      userId,
      role: "pi",
      userName: "Dr. Ananya",
      threadId: "t-long",
      message: "latest question",
      model,
    });
    await new Response(stream).text();
    await completion;

    const contents = texts(model.received[0]);
    // system + 8 trimmed history + 1 new message
    expect(contents).toHaveLength(1 + MAX_HISTORY_TURNS + 1);
    expect(contents[1]).toBe("t4"); // t0–t3 trimmed away
    expect(contents.at(-2)).toBe("t11");
    expect(contents.at(-1)).toBe("latest question");
  });

  it("refuses an empty turn", async () => {
    const model = new CapturingModel({ responses: ["x"] });
    await expect(
      runGuideTurn(db, {
        userId,
        role: "pi",
        userName: "Dr. Ananya",
        threadId: "t-main",
        message: "   ",
        model,
      }),
    ).rejects.toThrow(GuideChatError);
  });
});
