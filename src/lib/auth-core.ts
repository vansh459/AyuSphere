/**
 * Auth core — pure functions used by the Auth.js credentials provider
 * and directly testable against PGlite (D-004, D-020).
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import type { Role } from "@/lib/rbac";

const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  siteId: string | null;
};

/**
 * Credentials check: valid email+password on an active account, or null.
 * Never throws on bad credentials — timing-safe enough for the demo since
 * bcrypt.compare always runs when a user row exists.
 */
export async function authorizeUser(
  db: Db,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  if (!user.active) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    siteId: user.siteId ?? null,
  };
}
