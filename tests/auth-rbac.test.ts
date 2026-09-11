import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  authorizeUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth-core";
import {
  CAPABILITIES,
  MUTATING_CAPABILITIES,
  ROLES,
  RbacError,
  assertCan,
  can,
} from "@/lib/rbac";
import { users } from "@/db/schema";
import type { Db } from "@/db";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  const hash = await hashPassword("correct-horse");
  await db.insert(users).values([
    {
      email: "pi@aiia.in",
      passwordHash: hash,
      name: "Dr. PI",
      role: "pi",
    },
    {
      email: "gone@aiia.in",
      passwordHash: hash,
      name: "Inactive",
      role: "coordinator",
      active: false,
    },
  ]);
});

describe("T0.4 — password hashing", () => {
  it("hash/verify roundtrip works and hashes are salted", async () => {
    const h1 = await hashPassword("s3cret");
    const h2 = await hashPassword("s3cret");
    expect(h1).not.toBe(h2);
    expect(await verifyPassword("s3cret", h1)).toBe(true);
    expect(await verifyPassword("wrong", h1)).toBe(false);
  });
});

describe("T0.4 — authorizeUser against PGlite", () => {
  it("accepts valid credentials and returns the session shape", async () => {
    const u = await authorizeUser(db as unknown as Db, "pi@aiia.in", "correct-horse");
    expect(u).not.toBeNull();
    expect(u!.role).toBe("pi");
    expect(u!).not.toHaveProperty("passwordHash");
  });

  it("normalizes email case/whitespace", async () => {
    const u = await authorizeUser(db as unknown as Db, "  PI@aiia.in ", "correct-horse");
    expect(u?.email).toBe("pi@aiia.in");
  });

  it("rejects wrong password, unknown user, inactive user", async () => {
    expect(await authorizeUser(db as unknown as Db, "pi@aiia.in", "nope")).toBeNull();
    expect(await authorizeUser(db as unknown as Db, "who@aiia.in", "x")).toBeNull();
    expect(
      await authorizeUser(db as unknown as Db, "gone@aiia.in", "correct-horse"),
    ).toBeNull();
  });
});

describe("T0.4 — RBAC matrix (architecture.md §10)", () => {
  it("regulator holds ZERO mutating capabilities", () => {
    for (const cap of MUTATING_CAPABILITIES) {
      expect(can("regulator", cap), `regulator must not have ${cap}`).toBe(
        false,
      );
    }
    expect(can("regulator", "audit.view")).toBe(true);
    expect(can("regulator", "dashboard.view")).toBe(true);
  });

  it("only ethics can pass the ethics gate", () => {
    for (const role of ROLES) {
      expect(can(role, "trial.ethicsReview")).toBe(role === "ethics");
    }
  });

  it("only PI approves CRFs/extractions; only PV reviews AEs; only admin manages users", () => {
    for (const role of ROLES) {
      expect(can(role, "crf.approve")).toBe(role === "pi");
      expect(can(role, "ae.review")).toBe(role === "pv");
      expect(can(role, "users.manage")).toBe(role === "admin");
    }
  });

  it("every role can view a dashboard; assertCan throws a typed error on deny", () => {
    for (const role of ROLES) expect(can(role, "dashboard.view")).toBe(true);
    expect(() => assertCan("monitor", "trial.manage")).toThrow(RbacError);
    expect(() => assertCan("pi", "trial.manage")).not.toThrow();
  });

  it("every mutating capability is a declared capability", () => {
    for (const cap of MUTATING_CAPABILITIES) {
      expect(CAPABILITIES).toContain(cap);
    }
  });
});
