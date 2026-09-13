import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { appSettings, auditEvents, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { ROLES, RbacError } from "@/lib/rbac";
import { NAV_ITEMS, navForRole } from "@/lib/nav";
import { ROLE_KNOWLEDGE } from "@/lib/guide/knowledge";
import {
  buildGuideSystemPrompt,
  getRoleKnowledge,
  trimHistory,
} from "@/lib/guide/prompt";
import { parseSseLine, streamGroqChat } from "@/lib/guide/groq";
import {
  getGuideConfig,
  getGuideSettingsView,
  saveGuideSettings,
} from "@/services/settings";

describe("Sphera — role knowledge slicing (no cross-role leakage)", () => {
  it("every role has a knowledge block", () => {
    for (const role of ROLES) {
      expect(ROLE_KNOWLEDGE[role].core_workflows.length).toBeGreaterThan(0);
      expect(ROLE_KNOWLEDGE[role].cannot_do.length).toBeGreaterThan(0);
    }
  });

  it("drift guard: every dashboard_section maps to a nav label that role actually has", () => {
    for (const role of ROLES) {
      const labels = new Set([
        "Dashboard",
        ...navForRole(role).map((i) => i.label),
      ]);
      for (const section of ROLE_KNOWLEDGE[role].dashboard_sections) {
        expect(labels.has(section), `${role}: '${section}' not in nav`).toBe(true);
      }
    }
    // and the map itself references real labels only
    const allLabels = new Set(["Dashboard", ...NAV_ITEMS.map((i) => i.label)]);
    for (const role of ROLES) {
      for (const s of ROLE_KNOWLEDGE[role].dashboard_sections) {
        expect(allLabels.has(s)).toBe(true);
      }
    }
  });

  it("coordinator slice has no PI/admin-only content; regulator slice is read-only", () => {
    const coord = JSON.stringify(getRoleKnowledge("coordinator"));
    expect(coord).not.toContain("Approve as record");
    expect(coord).not.toContain("Guide Assistant (Groq)");
    expect(coord).not.toContain("Audit Trail");
    const reg = JSON.stringify(getRoleKnowledge("regulator"));
    expect(reg).not.toContain("New Trial");
    expect(reg).not.toContain("Extract to CRF draft");
    expect(reg).toContain("Audit Trail");
  });

  it("system prompt embeds ONLY that role's slice plus guardrails", () => {
    const prompt = buildGuideSystemPrompt({ role: "ethics", userName: "Prof. S. Iyer" });
    expect(prompt).toContain("Ethics Committee");
    expect(prompt).toContain("Awaiting decision");
    expect(prompt).not.toContain("Extract to CRF draft"); // PI-only workflow
    // guardrail lines
    expect(prompt).toContain("redirect in one line");
    expect(prompt).toContain("name your model or provider");
    expect(prompt).toContain("don't pretend it doesn't exist");
    expect(prompt).toContain("Never expose internal details");
  });

  it("trimHistory keeps the most recent 8 turns", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `t${i}`,
    }));
    const trimmed = trimHistory(history);
    expect(trimmed).toHaveLength(8);
    expect(trimmed[0].content).toBe("t4");
    expect(trimmed[7].content).toBe("t11");
  });
});

describe("Sphera — Groq SSE parsing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parseSseLine extracts deltas and ignores DONE/noise", () => {
    expect(
      parseSseLine('data: {"choices":[{"delta":{"content":"Hi"}}]}'),
    ).toBe("Hi");
    expect(parseSseLine("data: [DONE]")).toBeNull();
    expect(parseSseLine(": ping")).toBeNull();
    expect(parseSseLine("data: not-json")).toBeNull();
  });

  it("streams concatenated text from a mocked SSE body", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Go to "}}]}',
      'data: {"choices":[{"delta":{"content":"**Participants**."}}]}',
      "data: [DONE]",
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        body: new Response(sse).body,
      })),
    );
    const stream = await streamGroqChat({
      apiKey: "k".repeat(20),
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "q" }],
    });
    const text = await new Response(stream).text();
    expect(text).toBe("Go to **Participants**.");
  });

  it("surfaces Groq API errors readably", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        body: null,
        json: async () => ({ error: { message: "Invalid API Key" } }),
      })),
    );
    await expect(
      streamGroqChat({
        apiKey: "bad-key-123",
        model: "m",
        messages: [{ role: "user", content: "q" }],
      }),
    ).rejects.toThrow("Invalid API Key");
  });
});

describe("Sphera — guide settings service", () => {
  let db: TestDb;
  let admin: Actor, pi: Actor;

  beforeAll(async () => {
    db = await createTestDb();
    const rows = await db
      .insert(users)
      .values([
        { email: "ad@g.demo", passwordHash: "x", name: "AD", role: "admin" },
        { email: "pi@g.demo", passwordHash: "x", name: "PI", role: "pi" },
      ])
      .returning();
    admin = { id: rows[0].id, role: "admin" };
    pi = { id: rows[1].id, role: "pi" };
  });

  afterEach(() => vi.unstubAllEnvs());

  it("admin-only; requires a key on first save", async () => {
    await expect(
      saveGuideSettings(db, pi, { model: "llama-3.3-70b-versatile", apiKey: "k".repeat(20) }),
    ).rejects.toThrow(RbacError);
    await expect(
      saveGuideSettings(db, admin, { model: "llama-3.3-70b-versatile", apiKey: "" }),
    ).rejects.toThrow(/Groq API key is required/);
  });

  it("saves, audits WITHOUT the key, blank key keeps stored one; view never exposes the key", async () => {
    await saveGuideSettings(db, admin, {
      model: "llama-3.3-70b-versatile",
      apiKey: "groq-test-key-abc",
    });
    await saveGuideSettings(db, admin, { model: "llama-3.1-8b-instant", apiKey: "" });

    const cfg = await getGuideConfig(db);
    expect(cfg).toEqual({ model: "llama-3.1-8b-instant", apiKey: "groq-test-key-abc" });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "settings.guide_update"));
    expect(audits.length).toBe(2);
    for (const a of audits) {
      expect(JSON.stringify(a.after)).not.toContain("groq-test-key-abc");
    }

    const view = await getGuideSettingsView(db);
    expect(view).toMatchObject({ model: "llama-3.1-8b-instant", keySet: true, source: "settings" });
    expect(JSON.stringify(view)).not.toContain("groq-test-key-abc");
  });

  it("env fallback when no settings row; null when nothing configured", async () => {
    const db2 = await createTestDb();
    vi.stubEnv("GROQ_API_KEY", "env-groq-key");
    expect(await getGuideConfig(db2)).toMatchObject({ apiKey: "env-groq-key" });
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GROQ_API", "");
    expect(await getGuideConfig(db2)).toBeNull();
    // GROQ_API is accepted as an alias (real-world .env naming, 2026-09-13)
    vi.stubEnv("GROQ_API", "alias-groq-key");
    expect(await getGuideConfig(db2)).toMatchObject({ apiKey: "alias-groq-key" });
    expect(await getGuideSettingsView(db2)).toMatchObject({
      keySet: true,
      source: "env",
    });
    vi.stubEnv("GROQ_API", "");
    // settings row (from db above) wins over env
    vi.stubEnv("GROQ_API_KEY", "env-groq-key");
    const cfg = await getGuideConfig(db);
    expect(cfg?.apiKey).toBe("groq-test-key-abc");
  });

  it("appSettings row exists under the guide key", async () => {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "guide_ai"));
    expect(row).toBeTruthy();
  });
});
