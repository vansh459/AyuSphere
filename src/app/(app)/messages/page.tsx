import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { contacts, type Contact } from "@/services/messages";
import { DbErrorState, PageHeader } from "@/components/app/shared";
import { MessagesClient } from "./messages-client";

export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user.role, "chat.use")) redirect("/dashboard");

  let list: Contact[] = [];
  let dbError = false;
  try {
    list = await contacts(getDb(), {
      id: session.user.id,
      role: session.user.role,
    });
  } catch {
    dbError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        subtitle="Direct messages with anyone on the platform — share notes, documents, and images."
      />
      {dbError ? (
        <DbErrorState />
      ) : (
        <MessagesClient
          selfId={session.user.id}
          initialContacts={list.map((c) => ({
            ...c,
            lastMessageAt: c.lastMessageAt
              ? c.lastMessageAt.toISOString()
              : null,
          }))}
        />
      )}
    </div>
  );
}
