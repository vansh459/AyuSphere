import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Bell, ChevronDown, Search } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { navForRole } from "@/lib/nav";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { adverseEvents, alerts, amendments, messages, trials } from "@/db/schema";
import { Sidebar } from "@/components/app/sidebar";
import { GuideWidget } from "@/components/app/guide-widget";
import { MessageToast } from "@/components/app/message-toast";
import { Button } from "@/components/ui/button";

const ROLE_LABEL: Record<string, string> = {
  pi: "Principal Investigator",
  coordinator: "Study Coordinator",
  monitor: "Monitor",
  ethics: "Ethics Committee",
  pv: "Pharmacovigilance",
  admin: "Administrator",
  regulator: "Regulator (read-only)",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;
  const items = navForRole(user.role);

  let openAlerts = 0;
  let unreadMessages = 0;
  let openAdverseEvents = 0;
  let pendingEthics = 0;

  try {
    const db = getDb();
    const [openAlertsRes, unreadMessagesRes, openAeRes, ethicsTrialsRes, ethicsAmendRes] =
      await Promise.all([
        can(user.role, "alert.acknowledge")
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(alerts)
              .where(eq(alerts.status, "open"))
              .catch(() => [{ count: 0 }])
          : Promise.resolve([{ count: 0 }]),
        can(user.role, "chat.use")
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(messages)
              .where(and(eq(messages.recipientId, user.id), isNull(messages.readAt)))
              .catch(() => [{ count: 0 }])
          : Promise.resolve([{ count: 0 }]),
        can(user.role, "ae.capture") || can(user.role, "ae.review")
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(adverseEvents)
              .where(inArray(adverseEvents.status, ["open", "under_review"]))
              .catch(() => [{ count: 0 }])
          : Promise.resolve([{ count: 0 }]),
        can(user.role, "trial.ethicsReview")
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(trials)
              .where(eq(trials.status, "iec_review"))
              .catch(() => [{ count: 0 }])
          : Promise.resolve([{ count: 0 }]),
        can(user.role, "trial.ethicsReview")
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(amendments)
              .where(eq(amendments.status, "submitted"))
              .catch(() => [{ count: 0 }])
          : Promise.resolve([{ count: 0 }]),
      ]);

    openAlerts = Number(openAlertsRes[0]?.count ?? 0);
    unreadMessages = Number(unreadMessagesRes[0]?.count ?? 0);
    openAdverseEvents = Number(openAeRes[0]?.count ?? 0);
    pendingEthics =
      Number(ethicsTrialsRes[0]?.count ?? 0) +
      Number(ethicsAmendRes[0]?.count ?? 0);
  } catch {
    openAlerts = 0;
    unreadMessages = 0;
    openAdverseEvents = 0;
    pendingEthics = 0;
  }

  const initials = (user.name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen w-full">
      {/* chrome hides when printing — DSMB/SAE report artifacts print clean */}
      <div className="contents print:hidden">
        <Sidebar
          items={items}
          badges={{
            "/messages": unreadMessages,
            "/alerts": openAlerts,
            "/adverse-events": openAdverseEvents,
            "/ethics": pendingEthics,
          }}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-surface px-4 py-3 md:px-6 print:hidden">
          <label className="relative min-w-0 flex-1 md:max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-40" />
            <input
              type="search"
              placeholder="Search trials, participants, documents…"
              className="h-10 w-full rounded-xl border border-line bg-bg pl-9 pr-3 outline-none transition-colors duration-200 focus:border-primary"
            />
          </label>

          <div className="ml-auto flex items-center gap-3">
            {can(user.role, "alert.acknowledge") ? (
              <Link
                href="/alerts"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-ink transition-colors duration-200 hover:bg-primary-soft"
                aria-label={`Alerts (${openAlerts} open)`}
              >
                <span className="relative inline-flex items-center justify-center">
                  <Bell className="h-5 w-5 text-ink" />
                  {openAlerts > 0 ? (
                    <span
                      className="pointer-events-none absolute right-0 top-0 flex items-center justify-center rounded-full bg-danger text-white shadow-xs"
                      style={{
                        fontSize: "11px",
                        lineHeight: 1,
                        height: "18px",
                        minWidth: "18px",
                        padding: "0 5px",
                        border: "2px solid var(--color-surface, #ffffff)",
                        fontWeight: 700,
                        transform: "translate(45%, -35%)",
                      }}
                    >
                      {openAlerts > 9 ? "9+" : openAlerts}
                    </span>
                  ) : null}
                </span>
              </Link>
            ) : null}

            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-200 hover:bg-primary-soft">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-bold text-white">
                  {initials}
                </span>
                <span className="max-md:hidden">
                  <span className="block font-bold leading-tight">
                    {user.name}
                  </span>
                  <span className="block leading-tight opacity-60">
                    {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="clay absolute right-0 top-full z-20 mt-2 w-44 p-2">
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <Button variant="ghost" size="sm" type="submit" className="w-full">
                    Sign out
                  </Button>
                </form>
              </div>
            </details>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
      <GuideWidget userName={user.name ?? "there"} />
      {can(user.role, "chat.use") ? <MessageToast /> : null}
    </div>
  );
}
