import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CopilotClient } from "./copilot-client";

export default async function CopilotPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "copilot.use")) redirect("/dashboard");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading font-bold">AI Copilot</h1>
        <p className="mt-1 opacity-70">
          Ask about your authorized trial data. Every answer cites the records
          it used — when nothing supports an answer, it says so.
        </p>
      </div>
      <CopilotClient />
    </div>
  );
}
