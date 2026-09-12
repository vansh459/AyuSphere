/**
 * Electronic signatures (D-022, gap-plan T7.1) — GCP-style e-sign on
 * record-freezing actions. The signer re-enters their password
 * (bcrypt-verified against their account), states a fixed signature meaning,
 * and the signature row — actor, entity, action, meaning, SHA-256 hash of
 * the canonical signed payload — commits in the SAME transaction as the
 * guarded mutation: an unsigned freeze cannot commit, a refused signature
 * writes nothing.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { signatures, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth-core";
import type { Actor } from "@/lib/audit";

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureError";
  }
}

/** fixed 21-CFR-11-style meaning statements, shown verbatim in signing UIs */
export const SIGNATURE_MEANINGS = {
  approve: "I approve this record as accurate and complete.",
  correct:
    "I approve this correction as accurate and complete; the original record remains preserved.",
  report:
    "I confirm this safety report is complete and has been submitted to the regulatory authority.",
} as const;

export type SignatureAction = keyof typeof SIGNATURE_MEANINGS;

/** what a signing UI collects: the actor's re-entered password */
export type SignatureRequest = { password: string };

/**
 * Canonical JSON: object keys sorted recursively, dates as ISO strings —
 * the hash must not depend on key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/**
 * Re-authentication: verifies the re-entered password against the signer's
 * own active account. Runs BEFORE the guarded transaction, so a refused
 * signature leaves no trace of the attempted mutation.
 */
export async function verifySigner(
  db: Db,
  actor: Actor,
  signature: SignatureRequest | undefined,
): Promise<void> {
  if (!signature?.password) {
    throw new SignatureError(
      "signature required — re-enter your password to sign this action",
    );
  }
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);
  if (!user || !user.active) {
    throw new SignatureError("signer account not found or inactive");
  }
  const ok = await verifyPassword(signature.password, user.passwordHash);
  if (!ok) {
    throw new SignatureError("password verification failed — signature refused");
  }
}

/**
 * Inserts the signature row inside the caller's audited transaction, so the
 * signature and the mutation it covers commit (or fail) together.
 */
export async function recordSignature(
  tx: Tx,
  actor: Actor,
  input: {
    entityType: string;
    entityId: string;
    action: SignatureAction;
    payload: unknown;
  },
) {
  const [row] = await tx
    .insert(signatures)
    .values({
      actorId: actor.id,
      actorRole: actor.role,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      meaning: SIGNATURE_MEANINGS[input.action],
      payloadHash: payloadHash(input.payload),
    })
    .returning();
  return row;
}

/** signatures for a set of records — drives the "Signed" chips in the UI */
export async function signaturesFor(
  db: Db,
  entityType: string,
  entityIds: string[],
) {
  if (entityIds.length === 0) return [];
  return db
    .select()
    .from(signatures)
    .where(
      and(
        eq(signatures.entityType, entityType),
        inArray(signatures.entityId, entityIds),
      ),
    )
    .orderBy(desc(signatures.signedAt));
}
