"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cleanDomain,
  clearSenderVerdict,
  SENDER_VERDICTS,
  setSenderVerdict,
  webmailErrorUrl,
  type SenderVerdict,
} from "@/lib/filter-leak";
import { requireUserId } from "@/lib/session";

/**
 * Ajustes › Remitentes: cambia la decisión sobre un dominio. «sin_decidir» borra la fila de la
 * decisión. Valida el dominio y el veredicto en el servidor; el usuario sale de la sesión.
 */
export async function setSenderAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const domain = cleanDomain(String(formData.get("domain") ?? ""));
  const verdict = String(formData.get("verdict") ?? "");
  if (!domain) return;
  if (verdict === "sin_decidir") await clearSenderVerdict(userId, domain);
  else if ((SENDER_VERDICTS as readonly string[]).includes(verdict)) {
    const res = await setSenderVerdict(userId, domain, verdict as SenderVerdict);
    // Webmail como "empleo": no se escribió nada; se vuelve con el mensaje (RM-3)
    if (!res.ok) redirect(webmailErrorUrl("/settings/senders", domain));
  } else return;
  revalidatePath("/settings/senders");
  revalidatePath("/inbox");
}
