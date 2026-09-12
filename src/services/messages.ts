/**
 * Internal user-to-user messaging. Every signed-in role can chat (chat.use).
 * PRIVACY RULE: message bodies and attachments never enter the audit trail —
 * the message.send audit row records only { recipientId }.
 */
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { messages, users } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan, type Role } from "@/lib/rbac";

export const MAX_BODY_CHARS = 4000;

export const sendMessageInput = z.object({
  recipientId: z.string().uuid(),
  body: z.string().max(MAX_BODY_CHARS, `message exceeds ${MAX_BODY_CHARS} characters`).default(""),
  attachment: z
    .object({
      url: z.string().min(1),
      name: z.string().min(1),
      type: z.string().min(1),
    })
    .optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageInput>;

export async function sendMessage(db: Db, actor: Actor, input: SendMessageInput) {
  assertCan(actor.role, "chat.use");
  const data = sendMessageInput.parse(input);
  if (!data.body.trim() && !data.attachment) {
    throw new Error("message needs text or an attachment");
  }
  if (data.recipientId === actor.id) {
    throw new Error("you cannot message yourself");
  }
  const [recipient] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.id, data.recipientId))
    .limit(1);
  if (!recipient || !recipient.active) {
    throw new Error("recipient not found or inactive");
  }
  return withAudit(db, actor, "message.send", async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        senderId: actor.id,
        recipientId: data.recipientId,
        body: data.body,
        attachmentUrl: data.attachment?.url ?? null,
        attachmentName: data.attachment?.name ?? null,
        attachmentType: data.attachment?.type ?? null,
      })
      .returning();
    return {
      result: row,
      entityType: "message",
      entityId: row.id,
      // content stays OUT of the audit trail (privacy) — recipient only
      after: { recipientId: data.recipientId },
    };
  });
}

/**
 * Both directions of the thread with one user, oldest first, and marks the
 * incoming unread messages as read (a fetch of the thread IS the read).
 */
export async function conversation(
  db: Db,
  actor: Actor,
  withUserId: string,
  limit = 100,
) {
  assertCan(actor.role, "chat.use");
  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.senderId, withUserId),
        eq(messages.recipientId, actor.id),
        isNull(messages.readAt),
      ),
    );
  return db
    .select()
    .from(messages)
    .where(
      or(
        and(eq(messages.senderId, actor.id), eq(messages.recipientId, withUserId)),
        and(eq(messages.senderId, withUserId), eq(messages.recipientId, actor.id)),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

export type Contact = {
  id: string;
  name: string;
  role: Role;
  unreadCount: number;
  lastMessageAt: Date | null;
};

/** every active user except the actor, with unread count + last activity */
export async function contacts(db: Db, actor: Actor): Promise<Contact[]> {
  assertCan(actor.role, "chat.use");
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      // NB: ${users}.id (not ${users.id}) — a bare column in a select-list
      // subquery renders unqualified and would bind to the subquery's table
      unreadCount: sql<number>`(select count(*)::int from ${messages} m
        where m.sender_id = ${users}.id
          and m.recipient_id = ${actor.id}
          and m.read_at is null)`,
      lastMessageAt: sql<Date | null>`(select max(m.created_at) from ${messages} m
        where (m.sender_id = ${users}.id and m.recipient_id = ${actor.id})
           or (m.sender_id = ${actor.id} and m.recipient_id = ${users}.id))`,
    })
    .from(users)
    .where(and(eq(users.active, true), ne(users.id, actor.id)))
    .orderBy(asc(users.name));
  // sort by last activity (most recent first), quiet contacts after, by name
  return rows
    .map((r) => ({
      ...r,
      lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt) : null,
    }))
    .sort((a, b) => {
      if (a.lastMessageAt && b.lastMessageAt) {
        return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
      }
      if (a.lastMessageAt) return -1;
      if (b.lastMessageAt) return 1;
      return a.name.localeCompare(b.name);
    });
}
