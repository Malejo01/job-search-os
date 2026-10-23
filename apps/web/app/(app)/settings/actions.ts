"use server";

import { parseTargetRoles } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import type { FormActionError } from "@/app/components/guarded-form";
import { deleteAccount } from "@/lib/delete-account";
import { assignRandomInboundAddress } from "@/lib/inbound-address";
import { getTargetRolesLimit, setTargetRoles } from "@/lib/onboarding";
import { reassignForRoleChange, scheduleImmediateEvaluation } from "@/lib/pool-reassign";
import { requireActiveUserId, requireUserId } from "@/lib/session";

const DELETE_RETURN_TO = ["/settings", "/onboarding", "/terminos-actualizados"] as const;

/**
 * Elimina la cuenta de la sesión (JS-092). El usuario sale de la sesión, no del formulario:
 * nadie puede borrar otra cuenta cambiando un campo. Si el email o la contraseña no coinciden
 * vuelve a /settings con un error genérico; si borra, cierra la sesión y va a /login.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  // Sin requireActiveUserId: borrar tiene que poder hacerse sin aceptar los términos nuevos
  const userId = await requireUserId();
  const result = await deleteAccount(userId, {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  // Vuelve a la página desde la que se pidió (lista cerrada: nunca una URL del formulario)
  const back = DELETE_RETURN_TO.find((p) => p === formData.get("returnTo")) ?? "/settings";
  if (!result.ok) redirect(`${back}?error=confirmacion`);
  await signOut({ redirectTo: "/login" });
}

/**
 * Guarda los puestos que busca la persona (rondas 41 y 45). El usuario sale de la sesión; la lista se
 * valida en el servidor (solo claves conocidas, sin repetir, entre 1 y el tope de su plan); si no
 * pasa, devuelve `{ ok: false, field: "targetRoles" }` y la selección queda como estaba. Si el
 * conjunto cambió, reasigna las ofertas del pool; si la reasignación falla, los puestos igual
 * quedan guardados.
 */
export async function saveTargetRolesAction(formData: FormData): Promise<FormActionError | void> {
  const userId = await requireActiveUserId();
  const values = formData.getAll("targetRoles").filter((v): v is string => typeof v === "string");
  const parsed = parseTargetRoles(values, await getTargetRolesLimit(userId));
  if (!parsed.ok) return { ok: false, field: "targetRoles" };
  const { saved, changed } = await setTargetRoles(userId, parsed.roles);
  if (!saved) return { ok: false, field: "targetRoles" };
  if (changed) {
    const result = await reassignForRoleChange(userId);
    // Cuenta que nunca evaluó nada del pool: igual que Mis skills, evalúa las primeras enseguida
    if (result.firstTime) scheduleImmediateEvaluation(userId, result.enqueuedJobIds);
  }
  revalidatePath("/settings");
  revalidatePath("/jobs");
  redirect("/settings?puesto=guardado#puesto");
}

/**
 * Genera una dirección de email entrante nueva (JS-095). La anterior deja de funcionar al instante.
 * El usuario sale de la sesión. Vuelve a /settings con un aviso, nunca con la dirección en la URL.
 */
export async function rotateInboundAddressAction(): Promise<void> {
  const userId = await requireActiveUserId();
  const result = await assignRandomInboundAddress(userId);
  redirect(result.ok ? "/settings?direccion=nueva" : "/settings?direccion=sin_dominio");
}
