"use server";

import { esDiaValido } from "@/lib/momentos";
import { saveSaludoVisto } from "@/lib/primer-uso-cuenta";
import { requireTermsAcceptedUserId } from "@/lib/session";

/**
 * Guarda en la cuenta el día en que «Hoy» saludó con la mascota (R27-04). Solo la fila de quien llama; el
 * día se valida por su forma. Nunca lanza hacia la pantalla: si no se pudo guardar, el navegador ya
 * recordó el día y solo se repetiría en otro dispositivo.
 */
export async function markSaludoAction(day: string): Promise<void> {
  if (!esDiaValido(day)) return;
  try {
    const userId = await requireTermsAcceptedUserId();
    await saveSaludoVisto(userId, day);
  } catch {
    // Sin sesión, sin perfil o sin la columna todavía: no hay nada que guardar en la cuenta
  }
}
