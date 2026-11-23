import { z } from "zod";
import type { LlmWire } from "../evaluator/wire";
import { CV_BULLET_MAX_CHARS } from "../cv-out/verify";
import { CV_MAX_BULLETS } from "../cv-out/model";

/**
 * Versión del CV adaptada a una oferta (R20-04): salida del modelo. El modelo NO escribe el CV: solo propone
 * qué viñetas de cada entrada van y en qué orden, el orden de las skills y una lista de qué cambió y por qué.
 * Nombre, contacto, cargos, empresas y fechas no pasan por el modelo: salen del CV confirmado. Lo que vuelve
 * lo revisa `verifyCvTailor` antes de usarse; ante cualquier duda se descarta la versión entera.
 */
export const CV_TAILOR_MAX_ENTRIES = 40;
export const CV_TAILOR_MAX_SKILLS = 120;
export const CV_TAILOR_MAX_CHANGES = 8;
export const CV_TAILOR_WHAT_MAX_CHARS = 160;
export const CV_TAILOR_WHY_MAX_CHARS = 240;
export const CV_TAILOR_REF_MAX_CHARS = 40;
export const CV_TAILOR_SKILL_MAX_CHARS = 60;

export const CvTailorChangeSchema = z.strictObject({
  what: z.string().trim().min(5).max(CV_TAILOR_WHAT_MAX_CHARS),
  why: z.string().trim().min(5).max(CV_TAILOR_WHY_MAX_CHARS),
});
export type CvTailorChange = z.infer<typeof CvTailorChangeSchema>;

export const CvTailorOutputSchema = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        ref: z.string().trim().min(1).max(CV_TAILOR_REF_MAX_CHARS),
        bullets: z.array(z.string().trim().min(1).max(CV_BULLET_MAX_CHARS)).max(CV_MAX_BULLETS),
      }),
    )
    .max(CV_TAILOR_MAX_ENTRIES),
  skills: z
    .array(z.string().trim().min(1).max(CV_TAILOR_SKILL_MAX_CHARS))
    .max(CV_TAILOR_MAX_SKILLS),
  changes: z.array(CvTailorChangeSchema).max(CV_TAILOR_MAX_CHANGES),
});
export type CvTailorOutput = z.infer<typeof CvTailorOutputSchema>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Recorta a `max` sin partir una palabra (salvo que no haya un espacio donde cortar). */
function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let head = t.slice(0, max);
  if (/\s/.test(t.charAt(max))) return head.trimEnd();
  const lastSpace = head.search(/\s\S*$/);
  if (lastSpace > 0) return head.slice(0, lastSpace).trimEnd();
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head.trimEnd();
}

/**
 * Borde del modelo: al proveedor viaja el esquema sin límites; lo que vuelve se acota (cantidad de entradas,
 * de viñetas, de skills y de cambios; texto de los cambios) y recién ahí corre la validación estricta. Las
 * viñetas largas NO se recortan: un texto cortado a la mitad no es lo que el modelo quiso decir, y la
 * validación estricta lo descarta.
 */
export const cvTailorWire: LlmWire = {
  schema: z.object({
    entries: z.array(z.object({ ref: z.string(), bullets: z.array(z.string()) })),
    skills: z.array(z.string()),
    changes: z.array(z.object({ what: z.string(), why: z.string() })),
  }),
  normalize(raw) {
    if (!isRecord(raw)) return raw;
    const out: Record<string, unknown> = { ...raw };
    if (Array.isArray(out.entries)) {
      out.entries = out.entries
        .slice(0, CV_TAILOR_MAX_ENTRIES)
        .map((e: unknown) =>
          isRecord(e) && Array.isArray(e.bullets)
            ? { ...e, bullets: e.bullets.slice(0, CV_MAX_BULLETS) }
            : e,
        );
    }
    if (Array.isArray(out.skills)) out.skills = out.skills.slice(0, CV_TAILOR_MAX_SKILLS);
    if (Array.isArray(out.changes)) {
      out.changes = out.changes.slice(0, CV_TAILOR_MAX_CHANGES).map((c: unknown) =>
        isRecord(c)
          ? {
              ...c,
              what:
                typeof c.what === "string" ? clampText(c.what, CV_TAILOR_WHAT_MAX_CHARS) : c.what,
              why: typeof c.why === "string" ? clampText(c.why, CV_TAILOR_WHY_MAX_CHARS) : c.why,
            }
          : c,
      );
    }
    return out;
  },
};
