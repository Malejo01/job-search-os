"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { deleteAccount } from "@/lib/delete-account";
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
  if (!result.ok) redirect("/settings?error=confirmacion");
  await signOut({ redirectTo: "/login" });
}
