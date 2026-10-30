import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { currentSession } from "@/lib/session";

/**
 * Cierra una sesión que ya no vale y manda a /login: el usuario ya no existe (cuenta borrada, JS-092)
 * o la contraseña se reseteó después del login (S-6). Si la sesión todavía vale, no hay nada que
 * cerrar y vuelve a la app (así nadie puede deslogear a otro con un link). Sin sesión, a /login.
 * Sin esto, el middleware vería un JWT vigente en /login y volvería a redirigir a la app.
 */
export async function GET(): Promise<Response> {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (current.check === "ok") redirect("/hoy");
  await signOut({ redirectTo: "/login" }); // lanza el redirect de Next
  return new Response(null, { status: 204 });
}
