/**
 * AI-model settings — admin-managed, stored in app_settings, audited
 * WITHOUT ever writing the API key into the audit trail.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import {
  AI_SETTINGS_KEY,
  aiConfigSchema,
  defaultModelFor,
  type AiProvider,
} from "@/lib/ai/provider";

export type AiSettingsView = {
  provider: AiProvider | null;
  model: string | null;
  keySet: boolean;
  source: "settings" | "env" | "none";
};

/** what the UI may see — the key itself never leaves the server */
export async function getAiSettingsView(db: Db): Promise<AiSettingsView> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, AI_SETTINGS_KEY))
    .limit(1);
  if (row) {
    const parsed = aiConfigSchema.safeParse(row.value);
    if (parsed.success) {
      return {
        provider: parsed.data.provider,
        model: parsed.data.model,
        keySet: true,
        source: "settings",
      };
    }
  }
  if (process.env.GEMINI_API_KEY) {
    return { provider: "gemini", model: process.env.GEMINI_MODEL ?? defaultModelFor("gemini"), keySet: true, source: "env" };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? defaultModelFor("anthropic"), keySet: true, source: "env" };
  }
  return { provider: null, model: null, keySet: false, source: "none" };
}

export const saveAiSettingsInput = z.object({
  provider: z.enum(["anthropic", "gemini"]),
  model: z.string().min(1).max(80),
  /** blank = keep the previously stored key */
  apiKey: z.string().max(300).optional(),
});

export async function saveAiSettings(
  db: Db,
  actor: Actor,
  input: z.infer<typeof saveAiSettingsInput>,
) {
  assertCan(actor.role, "users.manage");
  const data = saveAiSettingsInput.parse(input);

  const [existing] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, AI_SETTINGS_KEY))
    .limit(1);
  const existingKey =
    existing && aiConfigSchema.safeParse(existing.value).success
      ? (existing.value as { apiKey: string }).apiKey
      : undefined;

  const apiKey = data.apiKey?.trim() || existingKey;
  if (!apiKey || apiKey.length < 8) {
    throw new Error("an API key is required (none stored yet)");
  }

  const value = { provider: data.provider, model: data.model.trim(), apiKey };
  aiConfigSchema.parse(value);

  return withAudit(db, actor, "settings.ai_update", async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: AI_SETTINGS_KEY, value, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: actor.id, updatedAt: sql`now()` },
      });
    return {
      result: { provider: value.provider, model: value.model },
      entityType: "app_setting",
      entityId: AI_SETTINGS_KEY,
      // the key itself is NEVER audited — only that it changed
      after: {
        provider: value.provider,
        model: value.model,
        apiKeyChanged: Boolean(data.apiKey?.trim()),
      },
    };
  });
}
