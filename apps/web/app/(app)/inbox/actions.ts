"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  bulkApply,
  cleanIds,
  deleteInbound,
  dismissInbound,
  markInboundSeen,
  restoreInbound,
  REVERSIBLE_BULK,
  undoBulk,
  type InboxPrevious,
  type ReversibleBulk,
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

export type BulkKind = ReversibleBulk | "delete";

/**
 * Acciones en lote (JS-049), llamadas desde la barra de selección. La acción viaja con su nombre
 * explícito y la lista de ids (nunca una posición en pantalla); el servidor valida ambos. Devuelve
 * cuántos emails tocó y el estado anterior de cada uno, para "Deshacer". "Eliminar" no se puede
 * deshacer: no devuelve estado. Su confirmación (una sola, con la cantidad) la pide el cliente.
 */
export async function bulkInboxAction(
  kind: BulkKind,
  ids: string[],
): Promise<{ n: number; previous: InboxPrevious[]; stay: number }> {
  const userId = await requireUserId();
  const list = cleanIds(Array.isArray(ids) ? ids.map(String) : []);
  let result: { n: number; previous: InboxPrevious[]; stay: number } = {
    n: 0,
    previous: [],
    stay: 0,
  };
  if ((REVERSIBLE_BULK as readonly string[]).includes(kind)) {
    result = await bulkApply(userId, kind as ReversibleBulk, list);
  } else if (kind === "delete") {
    result = { n: (await deleteInbound(userId, list)).deleted, previous: [], stay: 0 };
  }
  revalidatePath("/inbox");
  return result;
}

/** "Deshacer" de una acción en lote: restaura el estado anterior solo de esos ids. */
export async function undoBulkAction(previous: InboxPrevious[]): Promise<number> {
  const userId = await requireUserId();
  const n = await undoBulk(userId, Array.isArray(previous) ? previous : []);
  revalidatePath("/inbox");
  return n;
}
