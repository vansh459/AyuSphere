import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getDb } from "@/db";
import { messages, users } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!can(session.user.role, "chat.use")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const db = getDb();
    const [latest] = await db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        senderName: users.name,
        senderRole: users.role,
        body: messages.body,
        attachmentName: messages.attachmentName,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(users, eq(messages.senderId, users.id))
      .where(
        and(
          eq(messages.recipientId, session.user.id),
          isNull(messages.readAt),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return NextResponse.json(
      { message: latest ?? null },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to fetch latest unread" },
      { status: 500 },
    );
  }
}
