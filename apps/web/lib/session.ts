import { sessionVersionCheck, type SessionCheck } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { getAppDb } from "./db";
import { isOnboardingComplete } from "./onboarding";
import { needsTermsAcceptance } from "./terms-status";

/**
 * Estado de la sesión actual, sin redirigir: para las rutas de API, que contestan un código en vez
 * de mandar a /login. Falla cerrado si el usuario ya no existe (cuenta borrada, JS-092) o si la
 * versión de sesión del JWT no es la de la base (contraseña reseteada, S-6).
 */
type CurrentSession = { id: string; check: SessionCheck } | null;

export const currentSession = cache(async (): Promise<CurrentSession> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  // user_session_version (SECURITY DEFINER, rls/0011): el rol de la app no lee users ajenos
  const [row] = (await getAppDb().execute(
    sql`select user_session_version(${id}::uuid) as v`,
  )) as unknown as { v: number | null }[];
  return { id, check: sessionVersionCheck(session?.sessionVersion, row?.v ?? null) };
});

/** users.id de una sesión que sigue valiendo, o null. Para las rutas de API. */
export async function sessionUserId(): Promise<string | null> {
  const current = await currentSession();
  return current?.check === "ok" ? current.id : null;
}

/**
 * users.id de la sesión actual; sin sesión redirige a /login (el middleware ya lo hace, esto es el cinturón).
 * Falla cerrado si el usuario ya no existe (cuenta borrada, JS-092) o si la sesión quedó vieja por
 * un reset de contraseña (S-6): el JWT dura 14 días y no hay FK a `users`, así que sin este chequeo
 * una sesión vieja podría seguir escribiendo. El borrado de la cookie lo hace /api/session/ended (no
 * se puede desde un render y /login con JWT vigente rebotaría).
 * Con `cache` el chequeo corre una vez por request aunque lo llamen el layout y la página.
 */
export const requireUserId = cache(async (): Promise<string> => {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (current.check !== "ok") redirect("/api/session/ended");
  return current.id;
});

/**
 * Como `requireUserId`, pero además exige los términos vigentes aceptados (S-5, C-5 seguridad S-16).
 * Los gates de términos y onboarding viven en los layouts, que no corren cuando se invoca una server
 * action directamente: sin esto, una cuenta con los términos viejos podía seguir escribiendo.
 * Para las acciones del onboarding, que se usan antes de tener el perfil completo.
 */
export const requireTermsAcceptedUserId = cache(async (): Promise<string> => {
  const id = await requireUserId();
  if (await needsTermsAcceptance(id)) redirect("/terminos-actualizados");
  return id;
});

/**
 * Términos vigentes y onboarding completo: la misma condición que el layout de (app), para las server
 * actions que escriben desde la app. El borrado de cuenta NO la usa: tiene que funcionar desde
 * /terminos-actualizados y desde /onboarding.
 */
export const requireActiveUserId = cache(async (): Promise<string> => {
  const id = await requireTermsAcceptedUserId();
  if (!(await isOnboardingComplete(id))) redirect("/onboarding");
  return id;
});

/**
 * Como `requireActiveUserId` pero sin redirigir: para las Server Actions que devuelven un resultado
 * (las tarjetas del asistente, AG-5). null = sin sesión vigente, términos sin aceptar u onboarding
 * incompleto; el llamador contesta un código y la tarjeta lo muestra sin perder lo escrito.
 */
export async function activeSessionUserId(): Promise<string | null> {
  const id = await sessionUserId();
  if (!id) return null;
  if (await needsTermsAcceptance(id)) return null;
  if (!(await isOnboardingComplete(id))) return null;
  return id;
}
