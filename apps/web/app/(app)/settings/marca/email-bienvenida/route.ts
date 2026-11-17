import { adminRouteDenied } from "@/lib/admin-guard";
import { requireUserId } from "@/lib/session";
import { welcomeEmailSample } from "@/lib/welcome-email-sample";

export const dynamic = "force-dynamic";

/**
 * HTML del email de bienvenida con datos de ejemplo (C8-7), para verlo con el diseño. Solo admins
 * (los demás reciben 404). Es HTML propio y sin scripts (`brandedEmailHtml`); rigen los headers de
 * seguridad globales de `next.config.ts`.
 */
export async function GET(): Promise<Response> {
  const userId = await requireUserId();
  const denied = await adminRouteDenied(userId);
  if (denied) return denied;
  return new Response(welcomeEmailSample().html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
