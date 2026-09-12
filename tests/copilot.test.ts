import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { seed } from "@/db/seed";
import { adverseEvents, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import {
  answerQuestion,
  classifyIntent,
  type TextClient,
} from "@/services/copilot";

let db: TestDb;
let pi: Actor, pv: Actor, monitor: Actor, admin: Actor;

function mockLlm(answer = "Grounded answer [1].") {
  const complete = vi.fn(async (_prompt: string) => answer);
  const client: TextClient = { modelId: "mock-text-1", complete };
  return { client, complete };
}

beforeAll(async () => {
  db = await createTestDb();
  await seed(db);
  const rows = await db.select().from(users);
  const actor = (role: string): Actor => {
    const u = rows.find((r) => r.role === role)!;
    return { id: u.id, role: u.role };
  };
  pi = actor("pi");
  pv = actor("pv");
  monitor = actor("monitor");
  admin = actor("admin");
}, 180_000);

describe("T3.2 — intent routing", () => {
  it("classifies recruitment / safety / portfolio questions", () => {
    expect(classifyIntent("Which sites are behind target?")).toBe("recruitment");
    expect(classifyIntent("Any open SAEs near their deadline?")).toBe("safety");
    expect(classifyIntent("Summarize the studies")).toBe("portfolio");
  });
});

describe("T3.2 — grounded answers with citations", () => {
  it("answers the recruitment question citing the planted lagging site", async () => {
    const { client, complete } = mockLlm();
    const res = await answerQuestion(
      db,
      admin,
      "Which sites are behind target?",
      client,
    );
    expect(res.grounded).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    // GAC Pune 3/30 is the planted lagging site
    expect(res.citations.some((c) => c.label.includes("GAC Pune"))).toBe(true);
    // model context contained ONLY retrieved records
    const prompt = complete.mock.calls[0][0];
    expect(prompt).toContain("GAC Pune");
    expect(prompt).toContain("ONLY the JSON records");
  });

  it("safety intent cites real AE ids from the seed", async () => {
    const { client } = mockLlm();
    const res = await answerQuestion(db, pv, "Show open adverse events", client);
    expect(res.grounded).toBe(true);
    const aes = await db
      .select()
      .from(adverseEvents)
      .where(eq(adverseEvents.status, "open"));
    const ids = new Set(res.citations.map((c) => c.id));
    expect(aes.some((a) => ids.has(a.id))).toBe(true);
  });
});

describe("T3.2 — RBAC scope + hallucination control", () => {
  it("monitor lacks copilot.use entirely", async () => {
    const { client } = mockLlm();
    await expect(
      answerQuestion(db, monitor, "anything", client),
    ).rejects.toThrow(RbacError);
  });

  it("admin (full access) gets grounded safety answers", async () => {
    const { client, complete } = mockLlm();
    const res = await answerQuestion(db, admin, "list open SAEs", client);
    expect(res.grounded).toBe(true);
    expect(res.citations.length).toBeGreaterThan(0);
    expect(complete).toHaveBeenCalled();
  });

  it("empty retrieval → decline without model call (recruitment, nothing lagging)", async () => {
    // resolve the lag by deleting the lagging site's shortfall condition:
    // use a fresh DB with no data at all instead
    const db2 = await createTestDb();
    const [u] = await db2
      .insert(users)
      .values({ email: "a@x.demo", passwordHash: "x", name: "A", role: "admin" })
      .returning();
    const { client, complete } = mockLlm();
    const res = await answerQuestion(
      db2,
      { id: u.id, role: "admin" },
      "which sites are behind?",
      client,
    );
    expect(res.grounded).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it("PI can ask safety questions (ae.capture holder)", async () => {
    const { client, complete } = mockLlm();
    const res = await answerQuestion(db, pi, "open adverse events?", client);
    expect(res.grounded).toBe(true);
    expect(complete).toHaveBeenCalled();
  });
});
