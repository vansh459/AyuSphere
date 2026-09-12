import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { participants, sites, trialSites, trials } from "@/db/schema";
import {
  activateTrialSite,
  attachSiteToTrial,
  createSite,
} from "@/services/sites";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  DbErrorState,
  ErrorBanner,
  PageHeader,
  StatusBadge,
} from "@/components/app/shared";

export default async function SitesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("site.manage");
  const sp = await props.searchParams;

  let siteRows: (typeof sites.$inferSelect)[] = [];
  let trialRows: (typeof trials.$inferSelect)[] = [];
  let links: {
    ts: typeof trialSites.$inferSelect;
    siteName: string;
    protocolCode: string;
    enrolled: number;
  }[] = [];
  let dbError = false;
  try {
    const db = getDb();
    siteRows = await db.select().from(sites).orderBy(sites.name);
    trialRows = await db.select().from(trials).orderBy(trials.protocolCode);
    links = await db
      .select({
        ts: trialSites,
        siteName: sites.name,
        protocolCode: trials.protocolCode,
        enrolled: sql<number>`(select count(*)::int from ${participants} p where p.trial_site_id = ${trialSites.id})`,
      })
      .from(trialSites)
      .innerJoin(sites, eq(trialSites.siteId, sites.id))
      .innerJoin(trials, eq(trialSites.trialId, trials.id))
      .orderBy(trials.protocolCode, sites.name);
  } catch {
    dbError = true;
  }

  async function addSite(formData: FormData) {
    "use server";
    const actor = await requireActor("site.manage");
    try {
      await createSite(getDb(), actor, {
        name: String(formData.get("name") ?? ""),
        city: String(formData.get("city") ?? ""),
        state: String(formData.get("state") ?? ""),
      });
    } catch (e) {
      redirect(withError("/sites", e));
    }
    revalidatePath("/sites");
    redirect("/sites");
  }

  async function attach(formData: FormData) {
    "use server";
    const actor = await requireActor("site.manage");
    try {
      await attachSiteToTrial(getDb(), actor, {
        trialId: String(formData.get("trialId") ?? ""),
        siteId: String(formData.get("siteId") ?? ""),
        enrollmentTarget: Number(formData.get("enrollmentTarget") ?? 0),
      });
    } catch (e) {
      redirect(withError("/sites", e));
    }
    revalidatePath("/sites");
    redirect("/sites");
  }

  async function activate(formData: FormData) {
    "use server";
    const actor = await requireActor("site.manage");
    try {
      await activateTrialSite(getDb(), actor, String(formData.get("trialSiteId")));
    } catch (e) {
      redirect(withError("/sites", e));
    }
    revalidatePath("/sites");
    redirect("/sites");
  }

  const selectCls =
    "h-10 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sites"
        subtitle="Site registry, trial attachment and activation — enrolment opens only at active sites."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <CardTitle className="text-body font-bold">Register a site</CardTitle>
              <form action={addSite} className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3">
                  <Input name="name" placeholder="Site name" required />
                  <Input name="city" placeholder="City" required />
                  <Input name="state" placeholder="State" required />
                </div>
                <Button type="submit" className="self-start">
                  Add site
                </Button>
              </form>
            </Card>

            <Card className="flex flex-col gap-4">
              <CardTitle className="text-body font-bold">
                Attach a site to a trial
              </CardTitle>
              <form action={attach} className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="trialId">Trial</Label>
                    <select id="trialId" name="trialId" className={selectCls} required>
                      {trialRows.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.protocolCode}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="siteId">Site</Label>
                    <select id="siteId" name="siteId" className={selectCls} required>
                      {siteRows.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="enrollmentTarget">Target</Label>
                    <Input id="enrollmentTarget" name="enrollmentTarget" type="number" min={0} required />
                  </div>
                </div>
                <Button type="submit" className="self-start">
                  Attach
                </Button>
              </form>
            </Card>
          </div>

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Trial-site activations ({links.length})
            </CardTitle>
            {links.map(({ ts, siteName, protocolCode, enrolled }) => (
              <div
                key={ts.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <p className="font-medium">
                    {protocolCode} · {siteName}
                  </p>
                  <StatusBadge status={ts.activationStatus} />
                </div>
                <div className="flex items-center gap-4">
                  <span className="opacity-70">
                    {enrolled}/{ts.enrollmentTarget} enrolled
                  </span>
                  {ts.activationStatus === "pending" ? (
                    <form action={activate}>
                      <input type="hidden" name="trialSiteId" value={ts.id} />
                      <Button size="sm" type="submit">
                        Activate
                      </Button>
                    </form>
                  ) : ts.activatedAt ? (
                    <span className="opacity-50">
                      since {ts.activatedAt.toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
