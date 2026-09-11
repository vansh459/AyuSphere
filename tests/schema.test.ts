import { beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";

let db: TestDb;

/** raw-SQL helper: the driver-agnostic Db type erases row types */
async function run(q: SQL): Promise<{ rows: Record<string, unknown>[] }> {
  return (await db.execute(q)) as unknown as {
    rows: Record<string, unknown>[];
  };
}

beforeAll(async () => {
  db = await createTestDb();
});

describe("T0.3 — schema migrates onto PGlite (no Docker, D-019)", () => {
  it("creates all 15 domain tables", async () => {
    const res = await run(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const tables = res.rows.map((r) => r.table_name);
    for (const t of [
      "users",
      "trials",
      "sites",
      "trial_sites",
      "participants",
      "crf_templates",
      "visits",
      "crf_entries",
      "extractions",
      "adverse_events",
      "ae_actions",
      "documents",
      "milestones",
      "alerts",
      "audit_events",
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
  });

  it("participants table has NO direct-identifier columns (D-016)", async () => {
    const res = await run(
      sql`select column_name from information_schema.columns where table_name = 'participants'`,
    );
    const cols = res.rows.map((r) => String(r.column_name));
    for (const forbidden of [
      "name",
      "first_name",
      "last_name",
      "phone",
      "email",
      "address",
      "dob",
      "date_of_birth",
      "aadhaar",
    ]) {
      expect(cols).not.toContain(forbidden);
    }
    expect(cols).toContain("subject_code");
  });

  it("enforces at most one OPEN alert per (rule, entity) — partial unique index", async () => {
    await run(
      sql`insert into alerts (rule_key, entity_ref, severity, message, status)
          values ('visit_overdue', 'visit:x', 'warning', 'm', 'open')`,
    );
    await expect(
      run(
        sql`insert into alerts (rule_key, entity_ref, severity, message, status)
            values ('visit_overdue', 'visit:x', 'warning', 'm2', 'open')`,
      ),
    ).rejects.toThrow();
    // but a resolved row does not block a new open one
    await run(
      sql`update alerts set status = 'resolved' where entity_ref = 'visit:x'`,
    );
    await run(
      sql`insert into alerts (rule_key, entity_ref, severity, message, status)
          values ('visit_overdue', 'visit:x', 'warning', 'm3', 'open')`,
    );
    const res = await run(
      sql`select count(*)::int as n from alerts where entity_ref = 'visit:x'`,
    );
    expect(res.rows[0].n).toBe(2);
  });

  it("subject codes are unique", async () => {
    const user = await run(
      sql`insert into users (email, password_hash, name, role) values ('u@x.in','h','U','admin') returning id`,
    );
    const uid = user.rows[0].id as string;
    const trial = await run(
      sql`insert into trials (protocol_code, title, study_type, intervention, target_enrollment, created_by)
          values ('AYU-001','T','interventional','Ashwagandha',100,${uid}) returning id`,
    );
    const site = await run(
      sql`insert into sites (name, city, state) values ('AIIA Delhi','New Delhi','DL') returning id`,
    );
    const ts = await run(
      sql`insert into trial_sites (trial_id, site_id) values (${trial.rows[0].id},${site.rows[0].id}) returning id`,
    );
    const tsId = ts.rows[0].id as string;
    await run(
      sql`insert into participants (subject_code, trial_site_id) values ('AYU-001-P-0001', ${tsId})`,
    );
    await expect(
      run(
        sql`insert into participants (subject_code, trial_site_id) values ('AYU-001-P-0001', ${tsId})`,
      ),
    ).rejects.toThrow();
  });
});
