import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { navForRole } from "@/lib/nav";
import { Sidebar } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 gap-6 px-4 py-4 md:px-6">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="glass flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <p className="truncate font-bold">{user.name}</p>
            <Badge>{ROLE_LABEL[user.role] ?? user.role}</Badge>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </header>
        <main className="flex-1 pb-8">{children}</main>
      </div>
    </div>
  );
}
