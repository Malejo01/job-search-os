"use server";

import { schema as s } from "@job-search-os/db";
import { cvOtherLabel, cvPhone, cvProjectLink } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/db";
import { requireActiveUserId } from "@/lib/session";
import { CV_LINK_KEYS, type CvLinkKey } from "@/lib/cv-source";
import { CV_DOCUMENTO_TEXTOS } from "@/lib/textos-rediseno";

export type CvLinksState = {
  status: "idle" | "saved" | "error";
  /** Un mensaje por campo con error; nunca el valor escrito. */
  errors: Partial<Record<CvLinkKey | "otroEtiqueta" | "telefono", string>>;
};

/**
 * Guarda los links del CV (R33-07, C-45): LinkedIn, GitHub, portfolio y un «otro» con su etiqueta corta
 * (`otro` y `otro_etiqueta`), más el teléfono opcional (`telefono`, solo dígitos y signos de un teléfono), en
 * `application_settings.links` (jsonb: sin migración; la misma fila que usan las postulaciones; la clave `cv`
 * y las demás no se tocan). Solo `https`, sin
 * usuario ni email, hasta 200 caracteres (`cvProjectLink`); un campo vacío borra el link. El usuario sale de
 * la sesión y todo corre en `withUser` (RLS). Sin tabla nueva. Si algún campo es inválido no se guarda nada
 * y se devuelve cuál, sin repetir lo escrito.
 */
export async function saveCvLinksAction(
  _prev: CvLinksState,
  formData: FormData,
): Promise<CvLinksState> {
  const userId = await requireActiveUserId();
  const T = CV_DOCUMENTO_TEXTOS.links;
  const next: Partial<Record<CvLinkKey, string | null>> = {};
  const errors: CvLinksState["errors"] = {};
  for (const key of CV_LINK_KEYS) {
    const raw = formData.get(key);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") {
      next[key] = null;
      continue;
    }
    const ok = cvProjectLink(value);
    if (ok === null) errors[key] = T.errorFormato;
    else next[key] = ok;
  }
  // R33-07: etiqueta del «otro» link (texto plano corto) y teléfono (solo dígitos y signos de un teléfono)
  const text = (k: string) => {
    const raw = formData.get(k);
    return typeof raw === "string" ? raw.trim() : "";
  };
  const labelRaw = text("otroEtiqueta");
  let label: string | null = null;
  if (labelRaw !== "" && next.otro) {
    label = cvOtherLabel(labelRaw);
    if (label === null) errors.otroEtiqueta = T.errorEtiqueta;
  }
  const phoneRaw = text("telefono");
  let phone: string | null = null;
  if (phoneRaw !== "") {
    phone = cvPhone(phoneRaw);
    if (phone === null) errors.telefono = T.errorTelefono;
  }
  if (Object.keys(errors).length > 0) return { status: "error", errors };

  await withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ links: s.applicationSettings.links })
      .from(s.applicationSettings)
      .where(eq(s.applicationSettings.userId, userId))
      .limit(1);
    const links: Record<string, string> = { ...(row?.links ?? {}) };
    for (const key of CV_LINK_KEYS) {
      const v = next[key];
      if (v) links[key] = v;
      else delete links[key];
    }
    if (label) links.otro_etiqueta = label;
    else delete links.otro_etiqueta;
    if (phone) links.telefono = phone;
    else delete links.telefono;
    await tx
      .insert(s.applicationSettings)
      .values({ userId, links })
      .onConflictDoUpdate({
        target: s.applicationSettings.userId,
        set: { links, updatedAt: new Date() },
      });
  });
  revalidatePath("/cv");
  return { status: "saved", errors: {} };
}
