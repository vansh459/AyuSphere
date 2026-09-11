/** User administration (admin only) — workflow.md §1 roles. */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { withAudit, type Actor } from "@/lib/audit";
import { assertCan, ROLES } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth-core";

export const createUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: z.enum(ROLES),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export async function createUser(
  db: Db,
  actor: Actor,
  input: z.infer<typeof createUserInput>,
) {
  assertCan(actor.role, "users.manage");
  const data = createUserInput.parse(input);
  const passwordHash = await hashPassword(data.password);
  return withAudit(db, actor, "user.create", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: data.email.toLowerCase().trim(),
        name: data.name,
        role: data.role,
        passwordHash,
      })
      .returning();
    return {
      result: user,
      entityType: "user",
      entityId: user.id,
      after: { email: user.email, role: user.role },
    };
  });
}

export async function setUserActive(
  db: Db,
  actor: Actor,
  userId: string,
  active: boolean,
) {
  assertCan(actor.role, "users.manage");
  if (actor.id === userId && !active) {
    throw new Error("you cannot deactivate your own account");
  }
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing) throw new Error("user not found");
  return withAudit(db, actor, active ? "user.activate" : "user.deactivate", async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ active })
      .where(eq(users.id, userId))
      .returning();
    return {
      result: user,
      entityType: "user",
      entityId: userId,
      before: { active: existing.active },
      after: { active },
    };
  });
}
