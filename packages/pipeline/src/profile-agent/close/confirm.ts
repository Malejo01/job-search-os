/**
 * Confirmación del CV redactado (ADR-034 §2, R10-5). Lo que vuelve del navegador es entrada no confiable:
 * cada viñeta pasa el mismo filtro que las tarjetas (sin links ni emails, sin caracteres de control, sin
 * datos sensibles ni instrucciones escondidas). Una entrada con una viñeta que no pasa se descarta entera.
 * Las viñetas vienen de `applyCvWrite`, que ya las comparó con lo que dijo la persona; esto es la segunda
 * barrera, porque el navegador puede mandar cualquier cosa. Puro.
 */
import { z } from "zod";
import { detectCvInjection } from "../../cv/injection";
import { CV_BULLET_MAX_CHARS, hasLinkOrEmail } from "../../cv-out/verify";
import { findProfileSensitive } from "../sensitive";

export const PROFILE_AGENT_CONFIRM_MAX_ENTRIES = 20;
export const PROFILE_AGENT_CONFIRM_MAX_BULLETS = 6;

const CONTROL_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
);

const bullet = z
  .string()
  .trim()
  .min(1)
  .max(CV_BULLET_MAX_CHARS)
  .refine((t) => !CONTROL_RE.test(t), { message: "caracteres_de_control" })
  .refine((t) => !hasLinkOrEmail(t), { message: "link_o_email" });

export const profileWrittenEntrySchema = z.strictObject({
  id: z.string().uuid(),
  bullets: z.array(bullet).max(PROFILE_AGENT_CONFIRM_MAX_BULLETS),
});
export type ProfileWrittenEntry = z.infer<typeof profileWrittenEntrySchema>;

export const profileWrittenEntriesSchema = z
  .array(profileWrittenEntrySchema)
  .max(PROFILE_AGENT_CONFIRM_MAX_ENTRIES);

export type ProfileWrittenEntriesCheck =
  { ok: true; entries: ProfileWrittenEntry[]; dropped: number } | { ok: false };

/**
 * Valida lo que vuelve del navegador. Una forma inválida (clave de más, id que no es uuid, viñeta con
 * link) rechaza todo el pedido; una viñeta sensible o con instrucción escondida descarta su entrada.
 * Ids repetidos: gana el primero.
 */
export function checkProfileWrittenEntries(raw: unknown): ProfileWrittenEntriesCheck {
  const parsed = profileWrittenEntriesSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  const seen = new Set<string>();
  const entries: ProfileWrittenEntry[] = [];
  let dropped = 0;
  for (const e of parsed.data) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const bad = e.bullets.some(
      (b) => findProfileSensitive(b).length > 0 || detectCvInjection(b).hit,
    );
    if (bad) {
      dropped++;
      continue;
    }
    entries.push(e);
  }
  return { ok: true, entries, dropped };
}
