import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { crfEntries, crfTemplates, participants, visits } from "@/db/schema";
import { parseTemplateFields, type CrfField } from "@/lib/crf";
import { approveEntry, createDraftEntry, submitEntry } from "@/services/crf";
import { completeVisit } from "@/services/visits";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  BackLink,
  ErrorBanner,
  PageHeader,
  StatusBadge,
} from "@/components/app/shared";

function parseFieldValue(f: CrfField, raw: string): unknown {
  if (raw === "") return undefined;
  if (f.type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

export default async function VisitDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "crf.enter")) redirect("/dashboard");
  const { id } = await props.params;
  const sp = await props.searchParams;

  const db = getDb();
  const [row] = await db
    .select({
      visit: visits,
      template: crfTemplates,
      subjectCode: participants.subjectCode,
    })
    .from(visits)
    .innerJoin(participants, eq(visits.participantId, participants.id))
    .leftJoin(crfTemplates, eq(visits.templateId, crfTemplates.id))
    .where(eq(visits.id, id))
    .limit(1);
  if (!row) notFound();

  const fields: CrfField[] = row.template
    ? parseTemplateFields(row.template.fields)
    : [];
  const entries = await db
    .select()
    .from(crfEntries)
    .where(eq(crfEntries.visitId, id))
    .orderBy(desc(crfEntries.createdAt));
  const canApprove = can(session.user.role, "crf.approve");
  const isOpen = !["completed", "cancelled", "missed"].includes(row.visit.status);

  async function saveEntry(formData: FormData) {
    "use server";
    const actor = await requireActor("crf.enter");
    const db = getDb();
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const v = parseFieldValue(f, String(formData.get(`field_${f.name}`) ?? ""));
      if (v !== undefined) data[f.name] = v;
    }
    try {
      const draft = await createDraftEntry(db, actor, id, data);
      if (formData.get("intent") === "submit") {
        await submitEntry(db, actor, draft.id);
      }
    } catch (e) {
      redirect(withError(`/visits/${id}`, e));
    }
    revalidatePath(`/visits/${id}`);
    revalidatePath("/visits");
    redirect(`/visits/${id}`);
  }

  async function approve(formData: FormData) {
    "use server";
    const actor = await requireActor("crf.approve");
    try {
      await approveEntry(getDb(), actor, String(formData.get("entryId")));
    } catch (e) {
      redirect(withError(`/visits/${id}`, e));
    }
    revalidatePath(`/visits/${id}`);
    revalidatePath("/visits");
    redirect(`/visits/${id}`);
  }

  async function markComplete() {
    "use server";
    const actor = await requireActor("crf.enter");
    try {
      await completeVisit(getDb(), actor, id);
    } catch (e) {
      redirect(withError(`/visits/${id}`, e));
    }
    revalidatePath(`/visits/${id}`);
    revalidatePath("/visits");
    redirect(`/visits/${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/visits" label="Visit Schedule" />
      <PageHeader
        title={`${row.subjectCode} — ${row.visit.name}`}
        subtitle={`Window ${row.visit.windowStart.toLocaleDateString()} – ${row.visit.windowEnd.toLocaleDateString()}`}
        action={<StatusBadge status={row.visit.status} />}
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {isOpen && fields.length > 0 ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-body font-bold">
              e-CRF — {row.template!.name}
            </CardTitle>
            <Link href="/doctor-note" className="font-medium text-primary">
              or scan a doctor note →
            </Link>
          </div>
          <form action={saveEntry} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-2">
                  <Label htmlFor={`field_${f.name}`}>
                    {f.label}
                    {f.unit ? ` (${f.unit})` : ""}
                    {f.required ? " *" : ""}
                  </Label>
                  <Input
                    id={`field_${f.name}`}
                    name={`field_${f.name}`}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    step={f.type === "number" ? "any" : undefined}
                    min={f.min}
                    max={f.max}
                  />
                  {f.min !== undefined ? (
                    <p className="opacity-50">
                      plausible {f.min}–{f.max} {f.unit ?? ""} · {f.cdashVar}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <Button type="submit" name="intent" value="submit">
                Save & submit for approval
              </Button>
              <Button type="submit" name="intent" value="draft" variant="outline">
                Save draft
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {isOpen && fields.length === 0 ? (
        <Card>
          <p className="text-warning font-medium">
            No CRF template is configured for this visit type — data capture is
            disabled until one exists for the trial.
          </p>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <CardTitle className="text-body font-bold">
          Entries ({entries.length})
        </CardTitle>
        {entries.length === 0 ? (
          <p className="opacity-70">No CRF entries yet.</p>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  <span className="opacity-50">
                    v{e.version} · {e.source} ·{" "}
                    {e.createdAt.toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 break-all opacity-70">
                  {JSON.stringify(e.data)}
                </p>
              </div>
              {e.status === "submitted" && canApprove ? (
                <form action={approve}>
                  <input type="hidden" name="entryId" value={e.id} />
                  <Button size="sm" type="submit">
                    Approve
                  </Button>
                </form>
              ) : null}
            </div>
          ))
        )}
      </Card>

      {isOpen ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="opacity-70">
            Done capturing? Completing the visit stamps it and clears overdue
            alerts.
          </p>
          <form action={markComplete}>
            <Button variant="clay" type="submit">
              Mark visit completed
            </Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
