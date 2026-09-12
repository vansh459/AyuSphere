/**
 * Safety-signal aggregation (T8.1, gap-analysis G2) — the PS's "aggregate
 * safety signals to the Data Safety Monitoring Board and institutional
 * leadership". AEs are grouped by coded term (D-024; verbatim term when
 * uncoded) × trial, with per-site breakdown, SAE share, and a simple
 * disproportionality ratio: term share within the trial ÷ term share across
 * the portfolio. Flags are DECISION SUPPORT for human review — never
 * confirmed causality.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  participants,
  sites,
  suspectedAdrs,
  trialSites,
  trials,
} from "@/db/schema";
import { decodeMeddra } from "@/lib/dictionaries/meddra-subset";

/** a signal needs at least this many events in the trial … */
export const SIGNAL_MIN_COUNT = 3;
/** … and at least this disproportionality vs the portfolio baseline */
export const SIGNAL_RATIO_THRESHOLD = 2;

export type SignalInputRow = {
  /** grouping key: MedDRA code when coded, verbatim term otherwise */
  termKey: string;
  /** decoded Preferred Term, or the verbatim term */
  termLabel: string;
  soc: string | null;
  trialId: string;
  protocolCode: string;
  trialTitle: string;
  siteName: string;
  seriousness: "ae" | "sae";
};

export type SafetySignal = {
  termKey: string;
  termLabel: string;
  soc: string | null;
  trialId: string;
  protocolCode: string;
  trialTitle: string;
  /** events of this term in this trial */
  count: number;
  saeCount: number;
  /** all events in this trial */
  trialTotal: number;
  /** "Site A ×2 · Site B ×1" */
  siteBreakdown: string;
  /** (count/trialTotal) ÷ (portfolio term count/portfolio total); 0 when undefined */
  ratio: number;
  flagged: boolean;
};

/**
 * Pure aggregation — exact math, unit-tested on fixtures. Ratio compares the
 * term's share inside the trial to its share across the whole portfolio, so
 * a term clustering in one trial stands out against the baseline.
 */
export function computeSignals(rows: SignalInputRow[]): SafetySignal[] {
  const portfolioTotal = rows.length;
  if (portfolioTotal === 0) return [];

  const portfolioByTerm = new Map<string, number>();
  const trialTotals = new Map<string, number>();
  for (const r of rows) {
    portfolioByTerm.set(r.termKey, (portfolioByTerm.get(r.termKey) ?? 0) + 1);
    trialTotals.set(r.trialId, (trialTotals.get(r.trialId) ?? 0) + 1);
  }

  const groups = new Map<string, SignalInputRow[]>();
  for (const r of rows) {
    const key = `${r.trialId}::${r.termKey}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const signals: SafetySignal[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const count = group.length;
    const trialTotal = trialTotals.get(first.trialId)!;
    const portfolioShare = portfolioByTerm.get(first.termKey)! / portfolioTotal;
    const trialShare = count / trialTotal;
    const ratio = portfolioShare > 0 ? trialShare / portfolioShare : 0;

    const siteCounts = new Map<string, number>();
    for (const r of group) {
      siteCounts.set(r.siteName, (siteCounts.get(r.siteName) ?? 0) + 1);
    }

    signals.push({
      termKey: first.termKey,
      termLabel: first.termLabel,
      soc: first.soc,
      trialId: first.trialId,
      protocolCode: first.protocolCode,
      trialTitle: first.trialTitle,
      count,
      saeCount: group.filter((r) => r.seriousness === "sae").length,
      trialTotal,
      siteBreakdown: [...siteCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${name} ×${n}`)
        .join(" · "),
      ratio: Math.round(ratio * 100) / 100,
      flagged: count >= SIGNAL_MIN_COUNT && ratio >= SIGNAL_RATIO_THRESHOLD,
    });
  }

  return signals.sort(
    (a, b) =>
      Number(b.flagged) - Number(a.flagged) ||
      b.ratio - a.ratio ||
      b.count - a.count,
  );
}

/** all AEs (any status) with trial/site labels → signal input rows */
export async function loadSignalRows(db: Db): Promise<SignalInputRow[]> {
  const rows = await db
    .select({
      term: adverseEvents.term,
      meddraCode: adverseEvents.meddraCode,
      seriousness: adverseEvents.seriousness,
      trialId: trials.id,
      protocolCode: trials.protocolCode,
      trialTitle: trials.title,
      siteName: sites.name,
    })
    .from(adverseEvents)
    .innerJoin(participants, eq(adverseEvents.participantId, participants.id))
    .innerJoin(trialSites, eq(participants.trialSiteId, trialSites.id))
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id));

  return rows.map((r) => {
    const decoded = decodeMeddra(r.meddraCode);
    return {
      termKey: r.meddraCode ?? r.term.trim().toLowerCase(),
      termLabel: decoded?.pt ?? r.term,
      soc: decoded?.soc ?? null,
      trialId: r.trialId,
      protocolCode: r.protocolCode,
      trialTitle: r.trialTitle,
      siteName: r.siteName,
      seriousness: r.seriousness,
    };
  });
}

/** grouping id for the spontaneous (non-trial) series */
export const SPONTANEOUS_SERIES_ID = "spontaneous";

/**
 * NPvCC spontaneous reports (T8.3) join the aggregation as their own series:
 * grouped under a pseudo-trial "NPvCC" with the report source as the site,
 * so trial clusters are always read against the full surveillance baseline.
 */
export async function loadSpontaneousRows(db: Db): Promise<SignalInputRow[]> {
  const rows = await db
    .select({
      term: suspectedAdrs.term,
      meddraCode: suspectedAdrs.meddraCode,
      seriousness: suspectedAdrs.seriousness,
      source: suspectedAdrs.source,
    })
    .from(suspectedAdrs);
  return rows.map((r) => {
    const decoded = decodeMeddra(r.meddraCode);
    return {
      termKey: r.meddraCode ?? r.term.trim().toLowerCase(),
      termLabel: decoded?.pt ?? r.term,
      soc: decoded?.soc ?? null,
      trialId: SPONTANEOUS_SERIES_ID,
      protocolCode: "NPvCC",
      trialTitle: "Spontaneous ADR surveillance (NPvCC)",
      siteName: r.source,
      seriousness: r.seriousness,
    };
  });
}

export async function safetySignals(db: Db): Promise<SafetySignal[]> {
  const [trialRows, spontaneousRows] = await Promise.all([
    loadSignalRows(db),
    loadSpontaneousRows(db),
  ]);
  return computeSignals([...trialRows, ...spontaneousRows]);
}

export type TimelinessStats = {
  total: number;
  reported: number;
  reportedOnTime: number;
  reportedLate: number;
  openOverdue: number;
  /** 0–1 share of reported events filed within their deadline */
  onTimeRate: number;
};

/** reporting-timeliness aggregate for the DSMB summary (evaluation axis 2) */
export async function timelinessStats(
  db: Db,
  now = new Date(),
): Promise<TimelinessStats> {
  const rows = await db
    .select({
      reportedAt: adverseEvents.reportedAt,
      reportingDeadline: adverseEvents.reportingDeadline,
      status: adverseEvents.status,
    })
    .from(adverseEvents);

  let reported = 0;
  let reportedOnTime = 0;
  let reportedLate = 0;
  let openOverdue = 0;
  for (const r of rows) {
    if (r.reportedAt) {
      reported += 1;
      if (r.reportedAt.getTime() <= r.reportingDeadline.getTime()) {
        reportedOnTime += 1;
      } else {
        reportedLate += 1;
      }
    } else if (
      (r.status === "open" || r.status === "under_review") &&
      r.reportingDeadline.getTime() < now.getTime()
    ) {
      openOverdue += 1;
    }
  }
  return {
    total: rows.length,
    reported,
    reportedOnTime,
    reportedLate,
    openOverdue,
    onTimeRate: reported > 0 ? reportedOnTime / reported : 1,
  };
}
