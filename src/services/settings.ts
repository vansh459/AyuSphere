/**
 * App settings — admin-managed, stored in app_settings, audited.
 * AI-model config (API key NEVER audited) and the alert/deadline
 * thresholds (D-023): the PS's "configurable KPIs and alerting", literally.
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan } from "@/lib/rbac";
import { DEFAULT_DEADLINE_RULES } from "@/lib/rules/deadlines";
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

// ---------- alert & deadline configuration (D-023, T7.2) ----------

export const ALERT_CONFIG_KEY = "alert_config";

export const alertConfigSchema = z.object({
  /** recruitment below this fraction of target counts as lagging (0–1) */
  enrolmentLagThreshold: z.number().min(0).max(1),
  /** raise ae_deadline_approaching when the deadline is within this window */
  aeApproachingHours: z.number().int().min(1).max(720),
  /** raise milestone_due when a milestone falls due within this window */
  milestoneLookaheadDays: z.number().int().min(1).max(90),
  /** monitoring-visit cadence — the due date advances by this after each visit (T7.3) */
  monitoringCadenceDays: z.number().int().min(1).max(365),
  /** AE/SAE reporting-deadline rule table (representative NDCT-style values) */
  deadlineRules: z
    .array(
      z.object({
        seriousness: z.enum(["ae", "sae"]),
        initialHours: z.number().int().min(1).max(2160),
        detailedDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .refine(
      (rules) =>
        (["ae", "sae"] as const).every((s) =>
          rules.some((r) => r.seriousness === s),
        ),
      { message: "deadline rules must cover both 'ae' and 'sae'" },
    ),
});

export type AlertConfig = z.infer<typeof alertConfigSchema>;

/** today's built-in behavior — used whenever nothing is configured */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enrolmentLagThreshold: 0.5,
  aeApproachingHours: 24,
  milestoneLookaheadDays: 7,
  monitoringCadenceDays: 90,
  deadlineRules: DEFAULT_DEADLINE_RULES,
};

/**
 * Effective alert config: the stored document when valid, else the defaults.
 * A malformed stored value can never break the sweep — defaults apply.
 */
export async function getAlertConfig(db: Db): Promise<AlertConfig> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, ALERT_CONFIG_KEY))
    .limit(1);
  if (row) {
    const parsed = alertConfigSchema.safeParse(row.value);
    if (parsed.success) return parsed.data;
  }
  return DEFAULT_ALERT_CONFIG;
}

export async function saveAlertConfig(
  db: Db,
  actor: Actor,
  input: unknown,
): Promise<AlertConfig> {
  assertCan(actor.role, "users.manage");
  const value = alertConfigSchema.parse(input);

  return withAudit(db, actor, "settings.alert_update", async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: ALERT_CONFIG_KEY, value, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: actor.id, updatedAt: sql`now()` },
      });
    return {
      result: value,
      entityType: "app_setting",
      entityId: ALERT_CONFIG_KEY,
      after: value,
    };
  });
}

// ---------- AI-model configuration ----------

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
