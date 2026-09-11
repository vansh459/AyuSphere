/**
 * AI Copilot — grounded Q&A (architecture.md §9, workflow.md §11).
 * No SQL, no writes: intent routes to WHITELISTED retrieval functions that
 * run under the asker's RBAC scope. Empty retrieval → decline WITHOUT a
 * model call (the deck's hallucination control, literally).
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  adverseEvents,
  participants,
  sites,
  trialSites,
  trials,
} from "@/db/schema";
import type { Actor } from "@/lib/audit";
import { assertCan, can } from "@/lib/rbac";

export interface TextClient {
  readonly modelId: string;
  complete(prompt: string): Promise<string>;
}

export type Citation = { type: string; id: string; label: string };

export type CopilotAnswer = {
  answer: string;
  citations: Citation[];
  grounded: boolean;
};

// ---------- whitelisted retrieval functions ----------

async function sitesBehindTarget(db: Db, actor: Actor) {
  const rows = await db
    .select({
      trialSiteId: trialSites.id,
      trialTitle: trials.title,
      protocolCode: trials.protocolCode,
      siteName: sites.name,
      target: trialSites.enrollmentTarget,
      enrolled: sql<number>`(select count(*)::int from ${participants} p
        where p.trial_site_id = ${trialSites.id} and p.status = 'enrolled')`,
    })
    .from(trialSites)
    .innerJoin(trials, eq(trialSites.trialId, trials.id))
    .innerJoin(sites, eq(trialSites.siteId, sites.id))
    .where(eq(trials.status, "active"));
  return rows.filter((r) => r.target > 0 && r.enrolled / r.target < 0.5);
}

async function openSafetyEvents(db: Db, actor: Actor) {
  // PV and PI see safety detail; others with copilot.use see counts only
  if (!can(actor.role, "ae.capture") && !can(actor.role, "ae.review")) {
    return [];
  }
  return db
    .select({
      id: adverseEvents.id,
      term: adverseEvents.term,
      seriousness: adverseEvents.seriousness,
      status: adverseEvents.status,
      reportingDeadline: adverseEvents.reportingDeadline,
      subjectCode: participants.subjectCode,
    })
    .from(adverseEvents)
    .innerJoin(participants, eq(adverseEvents.participantId, participants.id))
    .where(inArray(adverseEvents.status, ["open", "under_review"]))
    .orderBy(adverseEvents.reportingDeadline);
}

async function trialPortfolio(db: Db) {
  // join + group-by (single-table FROM renders unqualified columns, which
  // makes correlated raw-SQL subqueries ambiguous — see listTrialsWithCounts)
  return db
    .select({
      id: trials.id,
      protocolCode: trials.protocolCode,
      title: trials.title,
      status: trials.status,
      targetEnrollment: trials.targetEnrollment,
      enrolled: sql<number>`(count(distinct ${participants.id}) filter (where ${participants.status} = 'enrolled'))::int`,
    })
    .from(trials)
    .leftJoin(trialSites, eq(trialSites.trialId, trials.id))
    .leftJoin(participants, eq(participants.trialSiteId, trialSites.id))
    .groupBy(trials.id);
}

// ---------- intent routing ----------

type Intent = "recruitment" | "safety" | "portfolio";

export function classifyIntent(question: string): Intent {
  const q = question.toLowerCase();
  if (/(behind|lag|recruit|enrol|target|slow)/.test(q)) return "recruitment";
  if (/(sae|adverse|safety|deadline|reaction|event)/.test(q)) return "safety";
  return "portfolio";
}

export async function answerQuestion(
  db: Db,
  actor: Actor,
  question: string,
  llm: TextClient,
): Promise<CopilotAnswer> {
  assertCan(actor.role, "copilot.use");
  const intent = classifyIntent(question);

  let context: unknown[] = [];
  let citations: Citation[] = [];

  if (intent === "recruitment") {
    const rows = await sitesBehindTarget(db, actor);
    context = rows;
    citations = rows.map((r) => ({
      type: "trial_site",
      id: r.trialSiteId,
      label: `${r.siteName} · ${r.protocolCode} (${r.enrolled}/${r.target})`,
    }));
  } else if (intent === "safety") {
    const rows = await openSafetyEvents(db, actor);
    context = rows;
    citations = rows.map((r) => ({
      type: "adverse_event",
      id: r.id,
      label: `${r.term} · ${r.subjectCode} (${r.seriousness.toUpperCase()})`,
    }));
  } else {
    const rows = await trialPortfolio(db);
    context = rows;
    citations = rows.map((r) => ({
      type: "trial",
      id: r.id,
      label: `${r.protocolCode} · ${r.title}`,
    }));
  }

  // hallucination control: nothing retrieved → decline, model NOT called
  if (context.length === 0) {
    return {
      answer:
        "No supporting records were found in the data you are authorized to see, so I can't answer that. Try rephrasing, or check the dashboards directly.",
      citations: [],
      grounded: false,
    };
  }

  const prompt = `You are AyuSphere's clinical-research copilot for AIIA.
Answer the user's question using ONLY the JSON records below. Cite record ids
in square brackets like [1], [2] matching the numbered records. If the records
do not answer the question, say so — never invent values.

Records:
${context.map((c, i) => `[${i + 1}] ${JSON.stringify(c)}`).join("\n")}

Question: ${question}

Answer (plain text, concise, with [n] citations):`;

  const answer = await llm.complete(prompt);
  return { answer, citations, grounded: true };
}
