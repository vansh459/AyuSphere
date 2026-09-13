import { redirect } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { auth, signOut } from "@/lib/auth";
import { navForRole } from "@/lib/nav";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { badgeCounts, type BadgeCounts } from "@/services/badges";
import { Sidebar } from "@/components/app/sidebar";
import { TopbarBell } from "@/components/app/live-badges";
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

  // initial counts only — the layout renders once per hard load, so the
  // Sidebar/TopbarBell keep these live client-side via /api/badges
  let badges: BadgeCounts = {
    "/messages": 0,
    "/alerts": 0,
    "/adverse-events": 0,
    "/ethics": 0,
  };
  try {
    badges = await badgeCounts(getDb(), { id: user.id, role: user.role });
  } catch {
    /* keep zeros */
  }
  const openAlerts = badges["/alerts"];

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
        <Sidebar items={items} badges={badges} />
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
              <TopbarBell initialCount={openAlerts} />
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
      {can(user.role, "chat.use") || can(user.role, "alert.acknowledge") ? (
        <MessageToast
          canChat={can(user.role, "chat.use")}
          canAlerts={can(user.role, "alert.acknowledge")}
        />
      ) : null}
    </div>
  );
}
