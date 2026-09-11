import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can, type Capability } from "@/lib/rbac";
import type { Actor } from "@/lib/audit";

/** Session → Actor for pages and server actions; redirects when absent. */
export async function requireActor(capability?: Capability): Promise<Actor> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor: Actor = { id: session.user.id, role: session.user.role };
  if (capability && !can(actor.role, capability)) redirect("/dashboard");
  return actor;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "The action failed.";
}

/** encode an error for the ?error= banner redirect pattern */
export function withError(path: string, e: unknown): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}error=${encodeURIComponent(errorMessage(e))}`;
}
