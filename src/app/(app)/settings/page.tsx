import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, withError } from "@/lib/actor";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createUser, setUserActive } from "@/services/users";
import {
  getAiSettingsView,
  getGuideSettingsView,
  saveAiSettings,
  saveGuideSettings,
  type AiSettingsView,
  type GuideSettingsView,
} from "@/services/settings";
import { defaultModelFor } from "@/lib/ai/provider";
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
  let ai: AiSettingsView = { provider: null, model: null, keySet: false, source: "none" };
  let guide: GuideSettingsView = { model: null, keySet: false, source: "none" };
  let dbError = false;
  try {
    const db = getDb();
    rows = await db.select().from(users).orderBy(users.email);
    ai = await getAiSettingsView(db);
    guide = await getGuideSettingsView(db);
  } catch {
    dbError = true;
  }

  async function saveAi(formData: FormData) {
    "use server";
    const actor = await requireActor("users.manage");
    try {
      await saveAiSettings(getDb(), actor, {
        provider: formData.get("provider") === "anthropic" ? "anthropic" : "gemini",
        model: String(formData.get("model") ?? ""),
        apiKey: String(formData.get("apiKey") ?? ""),
      });
    } catch (e) {
      redirect(withError("/settings", e));
    }
    revalidatePath("/settings");
    redirect("/settings");
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
    revalidatePath("/settings");
    redirect("/settings");
  }

  async function saveGuide(formData: FormData) {
    "use server";
    const actor = await requireActor("users.manage");
    try {
      await saveGuideSettings(getDb(), actor, {
        model: String(formData.get("guideModel") ?? ""),
        apiKey: String(formData.get("guideApiKey") ?? ""),
      });
    } catch (e) {
      redirect(withError("/settings", e));
    }
    revalidatePath("/settings");
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
    revalidatePath("/settings");
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-body font-bold">AI Model</CardTitle>
              {ai.keySet ? (
                <Badge tone="success">
                  {ai.provider} · {ai.model} ·{" "}
                  {ai.source === "env" ? "from environment" : "configured in UI"}
                </Badge>
              ) : (
                <Badge tone="warning">not configured</Badge>
              )}
            </div>
            <p className="opacity-70">
              Powers Doctor Note extraction and the AI Copilot. Settings saved
              here override environment variables; the API key is stored
              server-side and never displayed again.
            </p>
            <form action={saveAi} className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="provider">Provider</Label>
                <select
                  id="provider"
                  name="provider"
                  defaultValue={ai.provider ?? "gemini"}
                  className="h-10 rounded-[0.875rem] border border-line bg-surface px-3 outline-none focus:border-primary"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="anthropic">Anthropic Claude</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  name="model"
                  defaultValue={ai.model ?? defaultModelFor("gemini")}
                  placeholder="gemini-2.5-flash"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiKey">API key</Label>
                <Input
                  id="apiKey"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    ai.source === "settings"
                      ? "leave blank to keep current key"
                      : "paste your API key"
                  }
                />
              </div>
              <Button type="submit">Save AI settings</Button>
            </form>
            <p className="opacity-50">
              Model examples — Gemini: gemini-2.5-flash, gemini-2.5-pro ·
              Claude: claude-sonnet-5, claude-haiku-4-5-20251001
            </p>
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-body font-bold">
                Guide Assistant (Groq)
              </CardTitle>
              {guide.keySet ? (
                <Badge tone="success">
                  {guide.model} ·{" "}
                  {guide.source === "env" ? "from environment" : "configured in UI"}
                </Badge>
              ) : (
                <Badge tone="warning">not configured</Badge>
              )}
            </div>
            <p className="opacity-70">
              Powers Sphera, the floating role-aware guide on every screen. The
              key is stored server-side and never displayed again. Model list:
              console.groq.com/docs/models.
            </p>
            <form action={saveGuide} className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="guideModel">Model</Label>
                <Input
                  id="guideModel"
                  name="guideModel"
                  defaultValue={guide.model ?? "llama-3.3-70b-versatile"}
                  placeholder="llama-3.3-70b-versatile"
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="guideApiKey">Groq API key</Label>
                <Input
                  id="guideApiKey"
                  name="guideApiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    guide.source === "settings"
                      ? "leave blank to keep current key"
                      : "paste your Groq API key"
                  }
                />
              </div>
              <Button type="submit">Save guide settings</Button>
            </form>
          </Card>

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
