/**
 * Data-quality + protocol-deviation rules (workflow.md §12).
 * Pure functions over loaded rows; the service raises alerts from findings.
 */

export type QualityFinding = {
  kind:
    | "duplicate_entry"
    | "impossible_value"
    | "missing_entry"
    | "missing_required_assessment";
  entityRef: string;
  message: string;
};

export type EntryRow = {
  id: string;
  visitId: string;
  status: string;
  data: Record<string, unknown>;
};

export type VisitRow = {
  id: string;
  name: string;
  status: string;
};

/** two or more non-superseded approved entries on one visit */
export function findDuplicateEntries(entries: EntryRow[]): QualityFinding[] {
  const byVisit = new Map<string, EntryRow[]>();
  for (const e of entries) {
    if (e.status !== "approved") continue;
    byVisit.set(e.visitId, [...(byVisit.get(e.visitId) ?? []), e]);
  }
  const findings: QualityFinding[] = [];
  for (const [visitId, rows] of byVisit) {
    if (rows.length > 1) {
      findings.push({
        kind: "duplicate_entry",
        entityRef: `visit:${visitId}`,
        message: `${rows.length} approved CRF entries exist for one visit`,
      });
    }
  }
  return findings;
}

export type CrossFieldRule = {
  name: string;
  message: string;
  /** true = violation */
  check: (data: Record<string, unknown>) => boolean;
};

/** physiologically impossible combinations — configurable rule table */
export const DEFAULT_CROSS_FIELD_RULES: CrossFieldRule[] = [
  {
    name: "dbp_gte_sbp",
    message: "Diastolic BP is not below systolic BP",
    check: (d) =>
      typeof d.sbp === "number" &&
      typeof d.dbp === "number" &&
      d.dbp >= d.sbp,
  },
];

export function findImpossibleValues(
  entries: EntryRow[],
  rules: CrossFieldRule[] = DEFAULT_CROSS_FIELD_RULES,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const e of entries) {
    if (e.status === "superseded") continue;
    for (const rule of rules) {
      if (rule.check(e.data)) {
        findings.push({
          kind: "impossible_value",
          entityRef: `crf_entry:${e.id}`,
          message: `${rule.message} (rule: ${rule.name})`,
        });
      }
    }
  }
  return findings;
}

/** completed visits with no approved entry = missing required assessment */
export function findMissingEntries(
  visits: VisitRow[],
  entries: EntryRow[],
): QualityFinding[] {
  const approvedVisits = new Set(
    entries.filter((e) => e.status === "approved").map((e) => e.visitId),
  );
  return visits
    .filter((v) => v.status === "completed" && !approvedVisits.has(v.id))
    .map((v) => ({
      kind: "missing_required_assessment" as const,
      entityRef: `visit:${v.id}`,
      message: `Visit '${v.name}' completed without an approved CRF entry`,
    }));
}

export function runQualityRules(
  visits: VisitRow[],
  entries: EntryRow[],
  crossFieldRules?: CrossFieldRule[],
): QualityFinding[] {
  return [
    ...findDuplicateEntries(entries),
    ...findImpossibleValues(entries, crossFieldRules),
    ...findMissingEntries(visits, entries),
  ];
}
