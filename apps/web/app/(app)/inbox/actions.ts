"use server";

import { revalidatePath } from "next/cache";
import { deleteInbound, dismissInbound, markInboundSeen, restoreInbound } from "@/lib/inbox-list";
import { requireUserId } from "@/lib/session";

/** Acciones por email de /inbox (JS-038). La confirmación de "Eliminar" la pide el cliente. */
async function run(formData: FormData, fn: (userId: string, id: string) => Promise<unknown>) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await fn(userId, id);
  revalidatePath("/inbox");
}

export async function markSeenAction(formData: FormData): Promise<void> {
  await run(formData, markInboundSeen);
}

export async function dismissAction(formData: FormData): Promise<void> {
  await run(formData, dismissInbound);
}

export async function restoreAction(formData: FormData): Promise<void> {
  await run(formData, restoreInbound);
}

export async function deleteAction(formData: FormData): Promise<void> {
  await run(formData, deleteInbound);
}
