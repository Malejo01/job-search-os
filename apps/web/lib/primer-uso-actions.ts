"use server";

import { PRIMER_USO_VERSION } from "@/lib/primer-uso";
import { resetPrimerUsoVisto, savePrimerUsoVisto } from "@/lib/primer-uso-cuenta";
import { requireTermsAcceptedUserId } from "@/lib/session";

/**
 * Guarda en la cuenta que la persona terminó o salteó el recorrido de primer uso (R26-05). La versión sale
 * del código, no del pedido: el navegador no manda nada. Nunca lanza hacia la pantalla: si no se pudo
 * guardar, el navegador ya recordó lo suyo y el recorrido se vería de nuevo en otro dispositivo.
 */
/**
 * R26-03: «Abrir» el primer uso desde `/recorrido` lo vuelve a mostrar; además del navegador hay que borrar
 * la marca de la cuenta. Solo la de quien llama. Devuelve si se pudo; el llamador sigue igual.
 */
export async function resetPrimerUsoAction(): Promise<boolean> {
  try {
    const userId = await requireTermsAcceptedUserId();
    return await resetPrimerUsoVisto(userId);
  } catch {
    return false;
  }
}

export async function markPrimerUsoSeenAction(): Promise<void> {
  try {
    const userId = await requireTermsAcceptedUserId();
    await savePrimerUsoVisto(userId, PRIMER_USO_VERSION);
  } catch {
    // Sin sesión válida o sin perfil: no hay nada que guardar en la cuenta
  }
}
