/**
 * Internal messaging (chat.use) — service behavior on PGlite.
 * Privacy rule under test: audit rows for message.send NEVER contain the
 * message body or attachment — only the recipient id.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { auditEvents, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { ROLES } from "@/lib/rbac";
import {
  MAX_BODY_CHARS,
  contacts,
  conversation,
  sendMessage,
} from "@/services/messages";

let db: TestDb;
let alice: Actor; // pi
let bob: Actor; // coordinator
let ghostId: string; // inactive user
const actorsByRole = new Map<string, Actor>();

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      ...ROLES.map((role) => ({
        email: `${role}@chat.test`,
        passwordHash: "x",
        name: `${role} user`,
        role,
      })),
      {
        email: "ghost@chat.test",
        passwordHash: "x",
        name: "Ghost",
        role: "coordinator" as const,
        active: false,
      },
    ])
    .returning();
  for (const r of rows) {
    if (r.email === "ghost@chat.test") ghostId = r.id;
    else actorsByRole.set(r.role, { id: r.id, role: r.role });
  }
  alice = actorsByRole.get("pi")!;
  bob = actorsByRole.get("coordinator")!;
});

describe("sendMessage", () => {
  it("delivers in both directions with createdAt-asc ordering", async () => {
    await sendMessage(db, alice, { recipientId: bob.id, body: "hello bob" });
    await sendMessage(db, bob, { recipientId: alice.id, body: "hi alice" });
    await sendMessage(db, alice, { recipientId: bob.id, body: "how goes?" });

    const seenByAlice = await conversation(db, alice, bob.id);
    expect(seenByAlice.map((m) => m.body)).toEqual([
      "hello bob",
      "hi alice",
      "how goes?",
    ]);
    for (let i = 1; i < seenByAlice.length; i++) {
      expect(
        seenByAlice[i].createdAt.getTime(),
      ).toBeGreaterThanOrEqual(seenByAlice[i - 1].createdAt.getTime());
    }
    const seenByBob = await conversation(db, bob, alice.id);
    expect(seenByBob.map((m) => m.body)).toEqual(seenByAlice.map((m) => m.body));
  });

  it("rejects sending to yourself", async () => {
    await expect(
      sendMessage(db, alice, { recipientId: alice.id, body: "note to self" }),
    ).rejects.toThrow(/yourself/);
  });

  it("rejects an inactive recipient and an unknown recipient", async () => {
    await expect(
      sendMessage(db, alice, { recipientId: ghostId, body: "hello?" }),
    ).rejects.toThrow(/not found or inactive/);
    await expect(
      sendMessage(db, alice, {
        recipientId: "11111111-2222-4333-8444-555555555555",
        body: "hello?",
      }),
    ).rejects.toThrow(/not found or inactive/);
  });

  it("requires text or an attachment; attachment alone is fine; body is capped", async () => {
    await expect(
      sendMessage(db, alice, { recipientId: bob.id, body: "   " }),
    ).rejects.toThrow(/text or an attachment/);

    const withFile = await sendMessage(db, alice, {
      recipientId: bob.id,
      body: "",
      attachment: {
        url: "data:image/png;base64,AAAA",
        name: "scan.png",
        type: "image/png",
      },
    });
    expect(withFile.attachmentUrl).toBe("data:image/png;base64,AAAA");
    expect(withFile.attachmentName).toBe("scan.png");

    await expect(
      sendMessage(db, alice, {
        recipientId: bob.id,
        body: "x".repeat(MAX_BODY_CHARS + 1),
      }),
    ).rejects.toThrow();
  });

  it("audits message.send WITHOUT the message content (privacy)", async () => {
    const secret = "the secret lab values are 42/17";
    const sent = await sendMessage(db, alice, {
      recipientId: bob.id,
      body: secret,
      attachment: {
        url: "data:text/plain;base64,c2VjcmV0",
        name: "secret-report.txt",
        type: "text/plain",
      },
    });
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "message.send"),
          eq(auditEvents.entityId, sent.id),
        ),
      );
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe(alice.id);
    expect(audit.after).toEqual({ recipientId: bob.id });
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("secret-report.txt");
    expect(serialized).not.toContain("c2VjcmV0");
  });

  it("every role — including the read-only regulator — can send", async () => {
    for (const role of ROLES) {
      const actor = actorsByRole.get(role)!;
      const peer = role === "pi" ? bob : alice;
      const sent = await sendMessage(db, actor, {
        recipientId: peer.id,
        body: `ping from ${role}`,
      });
      expect(sent.senderId).toBe(actor.id);
    }
  });

});

describe("unread counts + read receipts", () => {
  it("counts unread, then zeroes after conversation() reads the thread", async () => {
    const monitor = actorsByRole.get("monitor")!;
    const ethics = actorsByRole.get("ethics")!;
    await sendMessage(db, monitor, { recipientId: ethics.id, body: "one" });
    await sendMessage(db, monitor, { recipientId: ethics.id, body: "two" });

    const before = await contacts(db, ethics);
    const monitorRow = before.find((c) => c.id === monitor.id)!;
    expect(monitorRow.unreadCount).toBe(2);
    expect(monitorRow.lastMessageAt).not.toBeNull();

    // reading the thread marks incoming as read
    const thread = await conversation(db, ethics, monitor.id);
    expect(thread.length).toBeGreaterThanOrEqual(2);
    for (const m of thread.filter((m) => m.recipientId === ethics.id)) {
      expect(m.readAt).not.toBeNull();
    }

    const after = await contacts(db, ethics);
    expect(after.find((c) => c.id === monitor.id)!.unreadCount).toBe(0);
  });

  it("contacts excludes self and inactive users, sorted by last activity", async () => {
    const list = await contacts(db, alice);
    expect(list.find((c) => c.id === alice.id)).toBeUndefined();
    expect(list.find((c) => c.id === ghostId)).toBeUndefined();
    // everyone alice exchanged messages with sorts before quiet contacts
    const withActivity = list.filter((c) => c.lastMessageAt !== null);
    const quiet = list.filter((c) => c.lastMessageAt === null);
    expect(list.slice(0, withActivity.length).every((c) => c.lastMessageAt)).toBe(
      true,
    );
    for (let i = 1; i < withActivity.length; i++) {
      expect(
        withActivity[i - 1].lastMessageAt!.getTime(),
      ).toBeGreaterThanOrEqual(withActivity[i].lastMessageAt!.getTime());
    }
    expect(withActivity.length + quiet.length).toBe(list.length);
  });
});
