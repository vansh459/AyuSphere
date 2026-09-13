"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { acknowledgeAlert } from "@/services/alerts";

export async function acknowledgeAlertAction(alertId: string) {
  const s = await auth();
  if (!s?.user) throw new Error("Unauthorized");
  await acknowledgeAlert(getDb(), { id: s.user.id, role: s.user.role }, alertId);
  revalidatePath("/alerts");
}
