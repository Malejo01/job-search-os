import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTargetRoles } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

/** Cookie de «Ahora no»: es solo UX (httpOnly, un año), igual que la del aviso de email. */
const ROLE_NUDGE_COOKIE = "jso_role_nudge";
const ROLE_NUDGE_MAX_AGE = 60 * 60 * 24 * 365;

/** «Ahora no»: guarda la cookie y el aviso no vuelve. No toca la base. */
async function dismissRoleNudgeAction(): Promise<void> {
  "use server";
  // El valor es el id del usuario (sale de la sesión): en un navegador compartido el descarte
  // de una cuenta no vale para otra
  const userId = await requireUserId();
  const jar = await cookies();
  jar.set(ROLE_NUDGE_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ROLE_NUDGE_MAX_AGE,
  });
  revalidatePath("/jobs");
}

/**
 * Aviso descartable de /jobs (ronda 41): si la persona no tiene puestos elegidos (`target_roles`
 * vacío, ronda 45; las cuentas anteriores pueden no tenerlos), le ofrece elegirlos en Ajustes. Server Component: lee la
 * cookie y la base (con RLS) en cada request.
 */
export async function RoleNudge({ userId }: { userId: string }) {
  const jar = await cookies();
  if (jar.get(ROLE_NUDGE_COOKIE)?.value === userId) return null;
  if ((await getTargetRoles(userId)).length > 0) return null;
  return (
    <div
      role="note"
      data-testid="role-nudge"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900"
    >
      <p>
        Elegí tu puesto para recibir ofertas que te sirvan.{" "}
        <Link href="/settings#puesto" className="font-medium underline">
          Elegir mi puesto
        </Link>
      </p>
      <form action={dismissRoleNudgeAction}>
        <button
          type="submit"
          className="rounded-md border border-sky-300 bg-white px-3 py-1 text-sm text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-900"
        >
          Ahora no
        </button>
      </form>
    </div>
  );
}
