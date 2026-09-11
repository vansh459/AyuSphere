import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { appSettings, auditEvents, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { RbacError } from "@/lib/rbac";
import { getAiConfig } from "@/lib/ai/provider";
import {
  createGeminiTextClient,
  createGeminiVisionClient,
} from "@/lib/ai/gemini";
import { getAiSettingsView, saveAiSettings } from "@/services/settings";

let db: TestDb;
let admin: Actor, pi: Actor;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "ad@s.demo", passwordHash: "x", name: "AD", role: "admin" },
      { email: "pi@s.demo", passwordHash: "x", name: "PI", role: "pi" },
    ])
    .returning();
  admin = { id: rows[0].id, role: "admin" };
  pi = { id: rows[1].id, role: "pi" };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AI settings service", () => {
  it("only admin can save; requires a key on first save", async () => {
    await expect(
      saveAiSettings(db, pi, { provider: "gemini", model: "gemini-2.5-flash", apiKey: "k".repeat(20) }),
    ).rejects.toThrow(RbacError);
    await expect(
      saveAiSettings(db, admin, { provider: "gemini", model: "gemini-2.5-flash", apiKey: "" }),
    ).rejects.toThrow(/API key is required/);
  });

  it("saves settings, audits WITHOUT the key, and blank key keeps the stored one", async () => {
    await saveAiSettings(db, admin, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "test-gemini-key-123",
    });
    // update model only, key blank → key preserved
    await saveAiSettings(db, admin, {
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "",
    });

    const cfg = await getAiConfig(db);
    expect(cfg).toEqual({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "test-gemini-key-123",
    });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "settings.ai_update"));
    expect(audits.length).toBe(2);
    for (const a of audits) {
      expect(JSON.stringify(a.after)).not.toContain("test-gemini-key-123");
    }

    const view = await getAiSettingsView(db);
    expect(view).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-pro",
      keySet: true,
      source: "settings",
    });
    expect(JSON.stringify(view)).not.toContain("test-gemini-key-123");
  });
});

describe("provider resolution order", () => {
  it("UI settings beat env vars; env is the fallback; none → null", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-claude-key");
    // settings row exists from prior test → settings win
    const cfg = await getAiConfig(db);
    expect(cfg?.provider).toBe("gemini");

    // fresh DB with no settings → env fallback (gemini first)
    const db2 = await createTestDb();
    vi.stubEnv("GEMINI_API_KEY", "env-gemini-key");
    const envCfg = await getAiConfig(db2);
    expect(envCfg).toMatchObject({ provider: "gemini", apiKey: "env-gemini-key" });

    vi.stubEnv("GEMINI_API_KEY", "");
    const claudeCfg = await getAiConfig(db2);
    expect(claudeCfg).toMatchObject({ provider: "anthropic", apiKey: "env-claude-key" });

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await getAiConfig(db2)).toBeNull();
  });
});

describe("Gemini client (mocked fetch)", () => {
  const cfg = { apiKey: "k".repeat(20), model: "gemini-2.5-flash" };

  function stubFetch(payload: unknown, ok = true, status = 200) {
    const fn = vi.fn(async () => ({
      ok,
      status,
      json: async () => payload,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: async () => new ArrayBuffer(4),
    }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("text client returns joined candidate text", async () => {
    stubFetch({
      candidates: [{ content: { parts: [{ text: "Grounded " }, { text: "answer [1]." }] } }],
    });
    const out = await createGeminiTextClient(cfg).complete("q");
    expect(out).toBe("Grounded answer [1].");
  });

  it("vision extract parses JSON output and sends the API key header", async () => {
    const fn = stubFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: '{"fields":{"sbp":{"value":128,"confidence":0.9}}}' },
            ],
          },
        },
      ],
    });
    const client = createGeminiVisionClient(cfg);
    const out = (await client.extract("data:image/jpeg;base64,AAAA", [
      { name: "sbp", label: "Systolic BP", type: "number", required: true, cdashVar: "VS" },
    ])) as { fields: Record<string, { value: number }> };
    expect(out.fields.sbp.value).toBe(128);
    expect(client.modelId).toBe("gemini-2.5-flash");

    const geminiCall = fn.mock.calls.find(
      (c) => String((c as unknown[])[0]).includes("generativelanguage.googleapis.com"),
    ) as unknown[] | undefined;
    expect(geminiCall).toBeTruthy();
    const init = geminiCall![1] as { headers: Record<string, string>; body: string };
    expect(init.headers["x-goog-api-key"]).toBe(cfg.apiKey);
    expect(init.body).toContain("responseMimeType");
  });

  it("surfaces Gemini API errors as readable messages", async () => {
    stubFetch({ error: { message: "API key not valid" } }, false, 400);
    await expect(createGeminiTextClient(cfg).complete("q")).rejects.toThrow(
      "API key not valid",
    );
  });
});
