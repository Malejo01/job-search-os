import { z } from "zod";
import { err, ok, type Result } from "../../result";
import { ROLE_KEYS, type RoleKey } from "../../skills/self-assessment";

/**
 * Lista de espera pública (ronda 63): validación del formulario "Pedir acceso". Puro: el servidor
 * guarda con waitlist_join (packages/db/rls/0006_waitlist.sql), que repite los largos.
 */

export const WAITLIST_LIMITS = { name: 120, email: 254, heardFrom: 200 } as const;

export const waitlistInputSchema = z.object({
  name: z.string().trim().min(1).max(WAITLIST_LIMITS.name),
  email: z.string().trim().toLowerCase().max(WAITLIST_LIMITS.email).email(),
  role: z.enum(ROLE_KEYS),
  heardFrom: z
    .string()
    .trim()
    .max(WAITLIST_LIMITS.heardFrom)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  /** Honeypot: las personas no lo ven, los bots lo completan */
  website: z.string().optional(),
});

export type WaitlistInput = z.infer<typeof waitlistInputSchema>;
export type WaitlistField = "name" | "email" | "role" | "heardFrom";
export type WaitlistFieldErrors = Partial<Record<WaitlistField, string>>;
export type WaitlistData = { name: string; email: string; role: RoleKey; heardFrom: string | null };

const MESSAGES: Record<WaitlistField, string> = {
  name: "Escribí tu nombre",
  email: "Ese email no parece válido",
  role: "Elegí una carrera",
  heardFrom: "Es demasiado largo (máximo 200 caracteres)",
};

/** Mensaje propio cuando el nombre excede el largo, en vez del "Escribí tu nombre" */
const NAME_TOO_LONG = "Es demasiado largo (máximo 120 caracteres)";

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Valida un FormData ya convertido a objeto. Devuelve los datos limpios (sin el honeypot) o un
 * mensaje corto por campo; nunca el valor escrito.
 */
export function parseWaitlistForm(
  raw: Record<string, unknown>,
): Result<WaitlistData, WaitlistFieldErrors> {
  const parsed = waitlistInputSchema.safeParse({
    name: textOf(raw.name),
    email: textOf(raw.email),
    role: textOf(raw.role),
    heardFrom: textOf(raw.heardFrom),
    website: raw.website === undefined ? undefined : textOf(raw.website),
  });
  if (!parsed.success) {
    const errors: WaitlistFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as WaitlistField | "website" | undefined;
      if (!field || field === "website" || errors[field]) continue;
      errors[field] =
        field === "name" && issue.code === "too_big" ? NAME_TOO_LONG : MESSAGES[field];
    }
    return err(errors);
  }
  const { name, email, role, heardFrom } = parsed.data;
  return ok({ name, email, role, heardFrom });
}

/** ¿El campo trampa vino con algo? Entonces es un bot: se responde como éxito sin guardar. */
export function isHoneypotFilled(input: { website?: unknown }): boolean {
  return typeof input.website === "string" && input.website.trim() !== "";
}
