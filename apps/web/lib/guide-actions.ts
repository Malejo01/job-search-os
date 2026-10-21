"use server";

import { cookies } from "next/headers";
import { GUIDE_COOKIE, GUIDE_MAX_AGE } from "@/lib/guide";
import { requireUserId } from "@/lib/session";

/** Saltar, terminar o rechazar la guía: guarda la cookie y la invitación no vuelve. No toca la base. */
export async function dismissGuideAction(): Promise<void> {
  // El valor es el id del usuario (sale de la sesión): en un navegador compartido cerrarla en una
  // cuenta no la cierra en otra
  const userId = await requireUserId();
  const jar = await cookies();
  jar.set(GUIDE_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUIDE_MAX_AGE,
  });
}
