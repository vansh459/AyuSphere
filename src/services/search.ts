/**
 * Quick-jump search (UI audit T6.4) — the topbar box was a dead input;
 * it now finds, RBAC-shaped: (1) the role's own screens by label,
 * (2) trials by protocol code/title for roles that can open /trials,
 * (3) participants by subject code for roles that manage participants.
 * Pure reads, no audit.
 */
import { ilike, or } from "drizzle-orm";
import type { Db } from "@/db";
import { participants, trials } from "@/db/schema";
import { can, type Role } from "@/lib/rbac";
import { navForRole } from "@/lib/nav";

export type SearchResult = {
  kind: "screen" | "trial" | "participant";
  label: string;
  hint: string;
  href: string;
};

const PER_BUCKET = 5;

export async function quickSearch(
  db: Db,
  actor: { role: Role },
  q: string,
): Promise<SearchResult[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const lower = needle.toLowerCase();

  // 1 · the role's own screens (works with an empty DB)
  const screens: SearchResult[] = navForRole(actor.role)
    .filter((i) => i.label.toLowerCase().includes(lower))
    .slice(0, PER_BUCKET)
    .map((i) => ({
      kind: "screen",
      label: i.label,
      hint: i.group,
      href: i.href,
    }));

  // 2 · trials — only for roles whose trial pages exist (/trials needs
  // trial.manage or trial.ethicsReview; ethics lands on /ethics instead)
  let trialResults: SearchResult[] = [];
  if (can(actor.role, "trial.manage") || can(actor.role, "trial.ethicsReview")) {
    const rows = await db
      .select({
        id: trials.id,
        protocolCode: trials.protocolCode,
        title: trials.title,
        status: trials.status,
      })
      .from(trials)
      .where(
        or(
          ilike(trials.protocolCode, `%${needle}%`),
          ilike(trials.title, `%${needle}%`),
        ),
      )
      .limit(PER_BUCKET);
    const trialHref = can(actor.role, "trial.manage")
      ? (id: string) => `/trials/${id}`
      : () => "/ethics";
    trialResults = rows.map((t) => ({
      kind: "trial",
      label: `${t.protocolCode} — ${t.title}`,
      hint: `trial · ${t.status.replaceAll("_", " ")}`,
      href: trialHref(t.id),
    }));
  }

  // 3 · participants by subject code — only for participant managers
  let participantResults: SearchResult[] = [];
  if (can(actor.role, "participant.manage")) {
    const rows = await db
      .select({
        subjectCode: participants.subjectCode,
        status: participants.status,
      })
      .from(participants)
      .where(ilike(participants.subjectCode, `%${needle}%`))
      .limit(PER_BUCKET);
    participantResults = rows.map((p) => ({
      kind: "participant",
      label: p.subjectCode,
      hint: `participant · ${p.status}`,
      // the participants page filters by trial via the protocol prefix
      href: `/participants?trial=${encodeURIComponent(
        p.subjectCode.split("-P-")[0] ?? "",
      )}`,
    }));
  }

  return [...screens, ...trialResults, ...participantResults];
}
