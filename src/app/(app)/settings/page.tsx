import { redirect } from "next/navigation";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createUser, setUserActive } from "@/services/users";
import { ROLES } from "@/lib/rbac";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DbErrorState,
  ErrorBanner,
  PageHeader,
} from "@/components/app/shared";

export default async function SettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireActor("users.manage");
  const sp = await props.searchParams;

  let rows: (typeof users.$inferSelect)[] = [];
  let dbError = false;
  try {
    rows = await getDb().select().from(users).orderBy(users.email);
  } catch {
    dbError = true;
  }

  async function addUser(formData: FormData) {
    "use server";
    const actor = await requireActor("users.manage");
    try {
      await createUser(getDb(), actor, {
        email: String(formData.get("email") ?? ""),
        name: String(formData.get("name") ?? ""),
        role: String(formData.get("role")) as (typeof ROLES)[number],
        password: String(formData.get("password") ?? ""),
      });
    } catch (e) {
      redirect(withError("/settings", e));
    }
    redirect("/settings");
  }

  async function toggleActive(formData: FormData) {
    "use server";
    const actor = await requireActor("users.manage");
    try {
      await setUserActive(
        getDb(),
        actor,
        String(formData.get("userId")),
        formData.get("active") === "true",
      );
    } catch (e) {
      redirect(withError("/settings", e));
    }
    redirect("/settings");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings — Users & Roles"
        subtitle="Account management. Every change is audited."
      />
      <ErrorBanner message={typeof sp.error === "string" ? sp.error : undefined} />

      {dbError ? (
        <DbErrorState />
      ) : (
        <>
          <Card className="flex flex-col gap-4">
            <CardTitle className="text-body font-bold">Create user</CardTitle>
            <form action={addUser} className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  name="role"
                  className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password (min 8)</Label>
                <Input id="password" name="password" type="password" required minLength={8} />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle className="text-body font-bold">
              Accounts ({rows.length})
            </CardTitle>
            {rows.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{u.name}</p>
                  <span className="opacity-50">{u.email}</span>
                  <Badge>{u.role}</Badge>
                  {!u.active ? <Badge tone="danger">inactive</Badge> : null}
                </div>
                <form action={toggleActive}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="active" value={String(!u.active)} />
                  <Button size="sm" variant={u.active ? "outline" : "primary"} type="submit">
                    {u.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </form>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
