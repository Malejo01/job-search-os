"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cleanIds,
  deleteInbound,
  dismissInbound,
  markInboundSeen,
  restoreInbound,
} from "@/lib/inbox-list";
import { requireUserId } from "@/lib/session";

/** Acciones por email de /inbox (JS-038). La confirmación de "Eliminar" la pide el cliente. */
async function run(formData: FormData, fn: (userId: string, id: string) => Promise<unknown>) {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await fn(userId, id);
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
}

export async function markSeenAction(formData: FormData): Promise<void> {
  await run(formData, markInboundSeen);
}

export async function dismissAction(formData: FormData): Promise<void> {
  await run(formData, dismissInbound);
}

export async function restoreAction(formData: FormData): Promise<void> {
  await run(formData, restoreInbound);
  // Desde el detalle, quedarse lo volvería a marcar visto: vuelve a la lista
  if (formData.get("volver") === "1") redirect("/inbox");
}

export async function deleteAction(formData: FormData): Promise<void> {
  await run(formData, deleteInbound);
  // Desde el detalle (JS-039) ya no queda nada que mostrar: vuelve a la lista
  if (formData.get("volver") === "1") redirect("/inbox");
}

export type BulkKind = "seen" | "dismiss" | "delete";

/**
 * Acciones en lote (JS-049), llamadas desde la barra de selección. Devuelve cuántos emails tocó.
 * La confirmación de "Eliminar" (una sola, con la cantidad) la pide el cliente.
 */
export async function bulkInboxAction(kind: BulkKind, ids: string[]): Promise<number> {
  const userId = await requireUserId();
  const list = cleanIds(Array.isArray(ids) ? ids.map(String) : []);
  let n = 0;
  if (kind === "seen") n = await markInboundSeen(userId, list);
  else if (kind === "dismiss") n = await dismissInbound(userId, list);
  else if (kind === "delete") n = (await deleteInbound(userId, list)).deleted;
  revalidatePath("/inbox");
  return n;
}
