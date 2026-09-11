import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can, type Capability } from "@/lib/rbac";
import type { Actor } from "@/lib/audit";

// error formatting lives in @/lib/errors (pure, testable); re-exported here
// so pages keep a single import site
export { errorMessage, withError } from "@/lib/errors";

/** Session → Actor for pages and server actions; redirects when absent. */
export async function requireActor(capability?: Capability): Promise<Actor> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor: Actor = { id: session.user.id, role: session.user.role };
  if (capability && !can(actor.role, capability)) redirect("/dashboard");
  return actor;
}
