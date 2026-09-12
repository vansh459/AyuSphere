import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { documents, trials } from "@/db/schema";
import { uploadDocument } from "@/services/documents";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocPreview } from "@/components/app/doc-preview";
import {
  DbErrorState,
  ErrorBanner,
  PageHeader,
} from "@/components/app/shared";

const MAX_DOC_BYTES = 2 * 1024 * 1024;

const KINDS = [
  ["protocol", "Protocol"],
  ["ethics_approval", "Ethics approval"],
  ["consent_form", "Consent form"],
  ["monitoring_report", "Monitoring report"],
  ["regulatory", "Regulatory"],
] as const;

export default async function DocumentsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("document.upload");
  const sp = await props.searchParams;
  const preselectTrial = typeof sp.trial === "string" ? sp.trial : undefined;

  let trialRows: (typeof trials.$inferSelect)[] = [];
  let docs: { d: typeof documents.$inferSelect; protocolCode: string }[] = [];
  let dbError = false;
  try {
    const db = getDb();
    trialRows = await db.select().from(trials).orderBy(trials.protocolCode);
    docs = await db
      .select({ d: documents, protocolCode: trials.protocolCode })
      .from(documents)
      .innerJoin(trials, eq(documents.trialId, trials.id))
      .orderBy(desc(documents.createdAt))
      .limit(100);
  } catch {
    dbError = true;
  }

  async function upload(formData: FormData) {
    "use server";
    const actor = await requireActor("document.upload");
    const file = formData.get("file");
    try {
      if (!(file instanceof File) || file.size === 0) {
        throw new Error("choose a file to upload");
      }
      if (file.size > MAX_DOC_BYTES) {
        throw new Error("file too large for the demo (max 2 MB)");
      }
      let blobUrl: string;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const { put } = await import("@vercel/blob");
        const stored = await put(
          `documents/${crypto.randomUUID()}-${file.name}`,
          file,
          { access: "public" },
        );
        blobUrl = stored.url;
      } else {
        const buf = Buffer.from(await file.arrayBuffer());
        blobUrl = `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
      }
      await uploadDocument(getDb(), actor, {
        trialId: String(formData.get("trialId")),
        kind: String(formData.get("kind")) as "protocol",
        title: String(formData.get("title") || file.name),
        blobUrl,
      });
    } catch (e) {
      redirect(withError("/documents", e));
    }
    revalidatePath("/documents");
    revalidatePath("/trials");
    redirect("/documents");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Documents"
        subtitle="Protocols, ethics approvals, consent forms — version history preserved."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <CardTitle className="text-body font-bold">Upload</CardTitle>
            <form action={upload} className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="trialId">Trial</Label>
                <select
                  id="trialId"
                  name="trialId"
                  defaultValue={preselectTrial}
                  className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary"
                  required
                >
                  {trialRows.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.protocolCode}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="kind">Kind</Label>
                <select
                  id="kind"
                  name="kind"
                  className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary"
                >
                  {KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" placeholder="Protocol v2" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="file">File (max 2 MB)</Label>
                <Input id="file" name="file" type="file" required />
              </div>
              <Button type="submit">Upload</Button>
            </form>
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Library ({docs.length})
            </CardTitle>
            {docs.length === 0 ? (
              <p className="opacity-70">No documents uploaded yet.</p>
            ) : (
              docs.map(({ d, protocolCode }) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{d.title}</p>
                    <Badge>v{d.version}</Badge>
                    <Badge tone="info">{d.kind.replaceAll("_", " ")}</Badge>
                    <span className="opacity-50">{protocolCode}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <DocPreview url={d.blobUrl} name={d.title} />
                    <span className="opacity-50">
                      {d.createdAt.toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}
