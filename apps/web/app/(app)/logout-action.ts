"use server";

import { signOut } from "@/auth";

/** «Salir» (en Perfil, dentro de «Más», desde C10-3). */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
