"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { deleteAccount } from "@/lib/delete-account";
import { assignRandomInboundAddress } from "@/lib/inbound-address";
import { requireUserId } from "@/lib/session";

/**
 * Elimina la cuenta de la sesión (JS-092). El usuario sale de la sesión, no del formulario:
 * nadie puede borrar otra cuenta cambiando un campo. Si el email o la contraseña no coinciden
 * vuelve a /settings con un error genérico; si borra, cierra la sesión y va a /login.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const result = await deleteAccount(userId, {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  // Vuelve a la página desde la que se pidió (lista cerrada: nunca una URL del formulario)
  const back = formData.get("returnTo") === "/onboarding" ? "/onboarding" : "/settings";
  if (!result.ok) redirect(`${back}?error=confirmacion`);
  await signOut({ redirectTo: "/login" });
}

/**
 * Genera una dirección de email entrante nueva (JS-095). La anterior deja de funcionar al instante.
 * El usuario sale de la sesión. Vuelve a /settings con un aviso, nunca con la dirección en la URL.
 */
export async function rotateInboundAddressAction(): Promise<void> {
  const userId = await requireUserId();
  const result = await assignRandomInboundAddress(userId);
  redirect(result.ok ? "/settings?direccion=nueva" : "/settings?direccion=sin_dominio");
}
