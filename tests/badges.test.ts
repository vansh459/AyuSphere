/**
 * Badge counts service — the single source behind the sidebar/topbar badges
 * (initial layout render AND /api/badges live refresh). Gate: the messages
 * badge counts ONLY the actor's unread incoming messages and drops to zero
 * once the thread is read; counts are role-shaped (no chat → no count).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { alerts, users } from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { badgeCounts } from "@/services/badges";
import { conversation, sendMessage } from "@/services/messages";

let db: TestDb;
let pi: Actor, coordinator: Actor;

beforeAll(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(users)
    .values([
      { email: "pi@b.demo", passwordHash: "x", name: "PI", role: "pi" },
      { email: "co@b.demo", passwordHash: "x", name: "CO", role: "coordinator" },
    ])
    .returning();
  pi = { id: rows[0].id, role: "pi" };
  coordinator = { id: rows[1].id, role: "coordinator" };
});

describe("badge counts (T-badges)", () => {
  it("unread messages count, and CLEAR once the thread is read", async () => {
    await sendMessage(db, coordinator, { recipientId: pi.id, body: "hello 1" });
    await sendMessage(db, coordinator, { recipientId: pi.id, body: "hello 2" });

    let badges = await badgeCounts(db, { id: pi.id, role: "pi" });
    expect(badges["/messages"]).toBe(2);
    // the sender sees nothing unread
    const senderBadges = await badgeCounts(db, {
      id: coordinator.id,
      role: "coordinator",
    });
    expect(senderBadges["/messages"]).toBe(0);

    // reading the thread (the same call the messages page makes) clears it —
    // this is exactly the "message dekh liya, badge still 1" bug condition
    await conversation(db, pi, coordinator.id);
    badges = await badgeCounts(db, { id: pi.id, role: "pi" });
    expect(badges["/messages"]).toBe(0);
  });

  it("alert count follows open alerts and role capability", async () => {
    await db.insert(alerts).values({
      ruleKey: "visit_overdue",
      entityRef: "visit:badge-test",
      severity: "warning",
      message: "m",
    });
    const piBadges = await badgeCounts(db, { id: pi.id, role: "pi" });
    expect(piBadges["/alerts"]).toBe(1);
    // ethics cannot acknowledge alerts → no alert badge for them
    const ethicsBadges = await badgeCounts(db, { id: pi.id, role: "ethics" });
    expect(ethicsBadges["/alerts"]).toBe(0);
  });
});
