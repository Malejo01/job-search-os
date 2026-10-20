import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { hasReceivedEmail } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

/** Cookie de «No, gracias»: es solo UX (httpOnly, un año), igual que `jso_filtros_ok`. */
export const EMAIL_NUDGE_COOKIE = "jso_email_nudge";
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
  revalidatePath("/onboarding/ofertas");
}

/**
 * Aviso descartable para sumar las alertas de email: si la persona nunca recibió un email y no lo
 * descartó, se muestra. Lo comparten /jobs y /onboarding/ofertas (misma cookie: «No, gracias» en
 * uno lo apaga en el otro). Server Component: lee la cookie y la base (con RLS) en cada request.
 * Sin `body`, el CTA va en línea con el título; con `body`, el texto va en su propia línea.
 */
export async function EmailNudge({
  userId,
  title,
  body,
  cta,
  href = "/settings/asistente",
}: {
  userId: string;
  title: string;
  body?: string;
  cta: string;
  href?: string;
}) {
  const jar = await cookies();
  if (jar.get(EMAIL_NUDGE_COOKIE)?.value === userId) return null;
  if (await hasReceivedEmail(userId)) return null;
  return (
    <div
      role="note"
      data-testid="email-nudge"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900"
    >
      {body ? (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{title}</p>
          <p>{body}</p>
          <p>
            <Link href={href} className="inline-flex min-h-11 items-center font-medium underline">
              {cta}
            </Link>
          </p>
        </div>
      ) : (
        <p>
          {title}{" "}
          <Link href={href} className="font-medium underline">
            {cta}
          </Link>
        </p>
      )}
      <form action={dismissEmailNudgeAction}>
        <button
          type="submit"
          className="min-h-11 rounded-md border border-sky-300 bg-white px-3 py-1 text-sm text-sky-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-900"
        >
          No, gracias
        </button>
      </form>
    </div>
  );
}
