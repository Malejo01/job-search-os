"use server";

import { createLogger, safeDbError } from "@job-search-os/adapters";
import {
  isHoneypotFilled,
  parseWaitlistForm,
  type WaitlistFieldErrors,
} from "@job-search-os/pipeline";
import { headers } from "next/headers";
import { joinWaitlist } from "@/lib/waitlist";

export type WaitlistState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string; fieldErrors?: WaitlistFieldErrors };

// Igual para ok y duplicate: así no se puede averiguar si un email ya está anotado
// No promete una invitación: el cupo es limitado y anotarse no garantiza lugar (C5-8). Igual para ok y
// duplicate. Sin una fecha de aviso: el mensaje tiene que seguir siendo cierto después del 26/11
const DONE_MESSAGE =
  "Listo, te anotamos. La beta abre el jueves 26/11 y el cupo es limitado: si hay lugar, te escribimos con el link para crear tu cuenta.";

/** Pedir acceso (sin sesión). Honeypot → éxito falso sin guardar; Zod; tope por IP en la base. */
export async function submitWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;

  if (isHoneypotFilled(raw)) return { status: "done", message: DONE_MESSAGE };

  const parsed = parseWaitlistForm(raw);
  if (!parsed.ok) {
    return { status: "error", message: "Revisá los campos marcados.", fieldErrors: parsed.error };
  }

  const h = await headers();
  // En Vercel el edge pisa estos headers con la IP real; fuera de Vercel son falsificables
  const ip =
    h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null;

  try {
    const status = await joinWaitlist(parsed.value, ip);
    if (status === "rate_limited") {
      return {
        status: "error",
        message: "Recibimos muchos pedidos desde tu conexión. Probá de nuevo en un rato.",
      };
    }
    return { status: "done", message: DONE_MESSAGE };
  } catch (e) {
    // Sin datos personales: ni el email, ni el nombre, ni la IP
    createLogger({ task: "waitlist_join" }).error(
      { err: safeDbError(e) },
      "lista de espera: falló",
    );
    return { status: "error", message: "No pudimos anotarte. Probá de nuevo en un rato." };
  }
}
