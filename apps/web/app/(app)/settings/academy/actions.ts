"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { canReviewAcademy } from "@/lib/academy-access";
import { loadAcademyFichas } from "@/lib/academy";
import { addReview } from "@/lib/academy-revisiones";
import { requireActiveUserId } from "@/lib/session";

const COMMENT_MAX = 500;

/**
 * Aprobar una ficha de Academy o pedir cambios (R26-01). Solo admins y testers: la app lo comprueba acá y la
 * base lo vuelve a exigir (`academy_review_add`). La huella la calcula el servidor con el contenido de la
 * ficha de hoy; nunca se recibe del formulario, así que no se puede aprobar un contenido que no se ve.
 * Una aprobación no cambia el archivo ni publica nada más que esa ficha con ese contenido exacto.
 */
export async function reviewFichaAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  if (!(await canReviewAcademy(userId))) notFound();
  const slug = String(formData.get("slug") ?? "");
  const decision = formData.get("decision");
  if (decision !== "aprobada" && decision !== "cambios") return;
  const ficha = loadAcademyFichas().find((f) => f.slug === slug);
  if (!ficha) return;
  const comment = String(formData.get("comment") ?? "")
    .trim()
    .slice(0, COMMENT_MAX);
  if (decision === "cambios" && !comment) return;
  await addReview(userId, {
    slug: ficha.slug,
    huella: ficha.huella,
    status: decision,
    comment: decision === "cambios" ? comment : null,
  });
  revalidatePath("/settings/academy");
  revalidatePath("/academy");
}
