"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cleanDomain,
  deleteDomainEmails,
  safeBackPath,
  SENDER_VERDICTS,
  setSenderVerdict,
  webmailErrorUrl,
  type SenderVerdict,
} from "@/lib/filter-leak";
import { requireActiveUserId } from "@/lib/session";

/** Aviso de fuga del filtro (JS-048): marcar un dominio o borrar todos sus emails. */
export async function senderVerdictAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const domain = cleanDomain(String(formData.get("domain") ?? ""));
  const verdict = String(formData.get("verdict") ?? "");
  if (!domain || !(SENDER_VERDICTS as readonly string[]).includes(verdict)) return;
  const res = await setSenderVerdict(userId, domain, verdict as SenderVerdict);
  // Webmail como "empleo": no se escribió nada; se vuelve a la página con el mensaje (RM-3)
  if (!res.ok) redirect(webmailErrorUrl(safeBackPath(formData.get("back")), domain));
  revalidatePath("/inbox");
  // También desde el detalle de un email sin cuerpo (JS-051)
  revalidatePath("/inbox/[id]", "page");
}

/** La confirmación (con la cantidad) la pide el cliente. Devuelve cuántos borró. */
export async function deleteDomainAction(rawDomain: string): Promise<number> {
  const userId = await requireActiveUserId();
  const domain = cleanDomain(String(rawDomain));
  if (!domain) return 0;
  const n = await deleteDomainEmails(userId, domain);
  revalidatePath("/inbox");
  return n;
}
