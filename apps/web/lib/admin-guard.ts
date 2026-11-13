import { notFound } from "next/navigation";
import { canCreateInvitations, NotInvitationAdminError } from "./invitations";

/**
 * Único helper para las pantallas, rutas y Server Actions de administración (R11-6). El criterio es el
 * de siempre (`ADMIN_EMAILS`, mirado en el servidor con la sesión) y falla cerrado: si la consulta
 * rompe, la cuenta no es admin. La lista de archivos de admin está en `admin-routes.ts`; un test
 * recorre `app/` y falla si alguno no llama a una de estas funciones.
 */

export async function isAdminUser(userId: string): Promise<boolean> {
  try {
    return await canCreateInvitations(userId);
  } catch {
    return false;
  }
}

/** Páginas y acciones sin flujo de error propio: una cuenta común recibe el 404 de siempre. */
export async function requireAdminOr404(userId: string): Promise<void> {
  if (!(await isAdminUser(userId))) notFound();
}

/** Server Actions que ya traducen `NotInvitationAdminError` a un mensaje o a un código. */
export async function requireAdminOrThrow(userId: string): Promise<void> {
  if (!(await isAdminUser(userId))) throw new NotInvitationAdminError();
}

/** Route handlers: devuelve la respuesta 404 para una cuenta común, o null si puede seguir. */
export async function adminRouteDenied(userId: string): Promise<Response | null> {
  if (await isAdminUser(userId)) return null;
  return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
}
