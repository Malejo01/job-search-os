import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { getAppDb } from "./db";
import { isOnboardingComplete } from "./onboarding";
import { needsTermsAcceptance } from "./terms-status";

/**
 * users.id de la sesión actual; sin sesión redirige a /login (el middleware ya lo hace, esto es el cinturón).
 * Falla cerrado si el usuario ya no existe (cuenta borrada, JS-092): el JWT dura 30 días y no hay FK
 * a `users`, así que sin este chequeo una sesión vieja podría crear filas huérfanas. El borrado de la
 * cookie lo hace /api/session/ended (no se puede desde un render y /login con JWT vigente rebotaría).
 * Con `cache` el chequeo corre una vez por request aunque lo llamen el layout y la página.
 */
export const requireUserId = cache(async (): Promise<string> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  // user_exists (SECURITY DEFINER): el rol de la app no lee users ajenos y acá solo importa si existe.
  const [row] = (await getAppDb().execute(
    sql`select user_exists(${id}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  if (!row?.ok) redirect("/api/session/ended");
  return id;
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
