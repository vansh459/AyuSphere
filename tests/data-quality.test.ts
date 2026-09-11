import { describe, expect, it } from "vitest";
import {
  findDuplicateEntries,
  findImpossibleValues,
  findMissingEntries,
  runQualityRules,
  type EntryRow,
  type VisitRow,
} from "@/lib/rules/data-quality";

const entry = (
  id: string,
  visitId: string,
  status: string,
  data: Record<string, unknown> = {},
): EntryRow => ({ id, visitId, status, data });

describe("T3.1 — duplicate entries", () => {
  it("flags two approved entries on one visit; drafts and superseded don't count", () => {
    const found = findDuplicateEntries([
      entry("e1", "v1", "approved"),
      entry("e2", "v1", "approved"),
      entry("e3", "v2", "approved"),
      entry("e4", "v2", "superseded"),
      entry("e5", "v3", "draft"),
      entry("e6", "v3", "draft"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "duplicate_entry",
      entityRef: "visit:v1",
    });
  });
});

describe("T3.1 — impossible values", () => {
  it("flags diastolic ≥ systolic; clean vitals pass", () => {
    const found = findImpossibleValues([
      entry("e1", "v1", "approved", { sbp: 120, dbp: 130 }),
      entry("e2", "v2", "approved", { sbp: 120, dbp: 80 }),
      entry("e3", "v3", "approved", { notes: "no vitals" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].entityRef).toBe("crf_entry:e1");
    expect(found[0].message).toContain("Diastolic");
  });

  it("honors a custom rule table", () => {
    const found = findImpossibleValues(
      [entry("e1", "v1", "approved", { dose_mg: 5000 })],
      [
        {
          name: "dose_cap",
          message: "Dose exceeds protocol cap",
          check: (d) => typeof d.dose_mg === "number" && d.dose_mg > 2000,
        },
      ],
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("protocol cap");
  });
});

describe("T3.1 — missing assessments", () => {
  const visits: VisitRow[] = [
    { id: "v1", name: "Baseline", status: "completed" },
    { id: "v2", name: "Week 4", status: "completed" },
    { id: "v3", name: "Week 12", status: "upcoming" },
  ];

  it("flags completed visits without an approved entry; upcoming visits exempt", () => {
    const found = findMissingEntries(visits, [
      entry("e1", "v1", "approved"),
      entry("e2", "v2", "draft"), // draft doesn't satisfy
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "missing_required_assessment",
      entityRef: "visit:v2",
    });
  });

  it("clean data produces zero findings end to end", () => {
    const found = runQualityRules(visits.slice(0, 1), [
      entry("e1", "v1", "approved", { sbp: 120, dbp: 80 }),
    ]);
    expect(found).toHaveLength(0);
  });
});
