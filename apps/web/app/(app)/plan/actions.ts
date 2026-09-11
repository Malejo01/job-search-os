"use server";

import { PLAN_STATUSES, type PlanStatus } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setPlanStatus } from "@/lib/plan";
import { requireUserId } from "@/lib/session";

/** Cambia el estado de un ítem del plan (JS-034). */
export async function setPlanStatusAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const itemId = String(formData.get("itemId") ?? "");
  const status = String(formData.get("status") ?? "") as PlanStatus;
  if (!itemId || !(PLAN_STATUSES as readonly string[]).includes(status)) redirect("/plan?error=1");
  await setPlanStatus(userId, itemId, status);
  revalidatePath("/plan");
}
