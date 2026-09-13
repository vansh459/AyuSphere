import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { getAuditTrail } from "@/services/audit-browser";
import { fmtDateTime } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AuditPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "audit.view")) redirect("/dashboard");

  const sp = await props.searchParams;
  const filters = {
    entityType: typeof sp.entityType === "string" ? sp.entityType : undefined,
    entityId: typeof sp.entityId === "string" ? sp.entityId : undefined,
    action: typeof sp.action === "string" ? sp.action : undefined,
  };

  let rows: Awaited<ReturnType<typeof getAuditTrail>> = [];
  let dbError = false;
  try {
    rows = await getAuditTrail(
      getDb(),
      { id: session.user.id, role: session.user.role },
      filters,
    );
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">Audit Trail</h1>
        <p className="mt-1 opacity-70">
          Immutable, time-stamped record of every action (ALCOA+). Insert-only
          at the database — nothing here can be edited or deleted.
        </p>
      </div>

      <form className="glass flex flex-wrap items-end gap-3 p-4" method="get">
        {(["entityType", "entityId", "action"] as const).map((name) => (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={name} className="microlabel">
              {name}
            </label>
            <input
              id={name}
              name={name}
              defaultValue={filters[name] ?? ""}
              className="h-9 rounded-xl border border-line bg-surface px-3 outline-none focus:border-primary"
            />
          </div>
        ))}
        <button
          type="submit"
          className="h-9 rounded-xl bg-primary px-4 font-medium text-white"
        >
          Filter
        </button>
      </form>

      {dbError ? (
        <Card>
          <p className="text-warning font-medium">
            Database not configured — set DATABASE_URL and run the seed.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="opacity-70">No audit events match these filters.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line">
                {["When", "Actor role", "Action", "Entity", "Change"].map(
                  (h) => (
                    <th key={h} className="microlabel px-4 py-3">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-b border-line align-top">
                  <td className="whitespace-nowrap px-4 py-3 opacity-70">
                    {fmtDateTime(e.at)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge>{e.actorRole}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">{e.action}</td>
                  <td className="px-4 py-3 opacity-70">
                    {e.entityType}
                    <span className="opacity-50"> · {e.entityId.slice(0, 8)}…</span>
                  </td>
                  <td className="max-w-[320px] px-4 py-3 opacity-70">
                    {e.before ? (
                      <div className="truncate">
                        <span className="microlabel">before </span>
                        {JSON.stringify(e.before)}
                      </div>
                    ) : null}
                    {e.after ? (
                      <div className="truncate">
                        <span className="microlabel">after </span>
                        {JSON.stringify(e.after)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
