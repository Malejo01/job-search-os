import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { hasReceivedEmail } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

/** Cookie de «No, gracias»: es solo UX (httpOnly, un año), igual que `jso_filtros_ok`. */
const EMAIL_NUDGE_COOKIE = "jso_email_nudge";
const EMAIL_NUDGE_MAX_AGE = 60 * 60 * 24 * 365;

/** «No, gracias»: guarda la cookie y el aviso no vuelve. No toca la base. */
async function dismissEmailNudgeAction(): Promise<void> {
  "use server";
  // El valor es el id del usuario (sale de la sesión): en un navegador compartido el descarte
  // de una cuenta no vale para otra
  const userId = await requireUserId();
  const jar = await cookies();
  jar.set(EMAIL_NUDGE_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: EMAIL_NUDGE_MAX_AGE,
  });
  revalidatePath("/jobs");
}

/**
 * Aviso descartable de /jobs: si la persona nunca recibió un email y no lo descartó, le ofrece
 * sumar sus alertas de empleo. Server Component: lee la cookie y la base (con RLS) en cada request.
 */
export async function EmailNudge({ userId }: { userId: string }) {
  const jar = await cookies();
  if (jar.get(EMAIL_NUDGE_COOKIE)?.value === userId) return null;
  if (await hasReceivedEmail(userId)) return null;
  return (
    <div
      role="note"
      data-testid="email-nudge"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900"
    >
      <p>
        ¿Recibís alertas de empleo por email?{" "}
        <Link href="/settings/asistente" className="font-medium underline">
          Sumalas en 3 pasos
        </Link>
      </p>
      <form action={dismissEmailNudgeAction}>
        <button
          type="submit"
          className="rounded-md border border-sky-300 bg-white px-3 py-1 text-sm text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-900"
        >
          No, gracias
        </button>
      </form>
    </div>
  );
}
