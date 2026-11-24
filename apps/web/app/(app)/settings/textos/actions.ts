"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { canReviewAcademy } from "@/lib/academy-access";
import { textosRediseno } from "@/lib/textos-aprobacion";
import { addTextReview } from "@/lib/textos-revisiones";
import { requireActiveUserId } from "@/lib/session";

const PROPUESTA_MAX = 1000;

/**
 * Aprobar un texto del rediseño o proponer otro (R26-02). Solo admins y testers: la app lo comprueba acá y la base
 * lo vuelve a exigir (`text_review_add`). La huella la calcula el servidor con el texto por defecto de hoy; la clave
 * tiene que ser una de las que existen. Una propuesta se guarda y nada más: no cambia ningún texto de la app.
 * Sirve a las dos pantallas (`/admin/textos` y `/settings/textos`).
 */
export async function reviewTextoAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  if (!(await canReviewAcademy(userId))) notFound();
  const clave = String(formData.get("clave") ?? "");
  const decision = formData.get("decision");
  if (decision !== "aprobada" && decision !== "propuesta") return;
  const texto = textosRediseno().find((t) => t.clave === clave);
  if (!texto) return;
  const proposal = String(formData.get("proposal") ?? "")
    .trim()
    .slice(0, PROPUESTA_MAX);
  if (decision === "propuesta" && !proposal) return;
  await addTextReview(userId, {
    clave: texto.clave,
    huella: texto.huella,
    estado: decision,
    proposal: decision === "propuesta" ? proposal : null,
  });
  revalidatePath("/admin/textos");
  revalidatePath("/settings/textos");
  revalidatePath("/admin/apertura");
}
