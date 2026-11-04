import Link from "next/link";
import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/password-reset";
import { Logo } from "@/components/brand/logo";

// Ver la nota en /setup: nunca dejar que Next congele una página que depende de estado en vivo.
export const dynamic = "force-dynamic";

export const metadata = { title: "Recuperar contraseña" };

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

/** Pide el link de recuperación (JS-045); server action sin JS de cliente. */
async function forgotPassword(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "");
  await requestPasswordReset(email);
  redirect("/forgot-password?sent=1");
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main
      id="contenido"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6"
    >
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <div>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Logo />
        </Link>
        <h1 className="text-2xl font-semibold">Olvidé mi contraseña</h1>
        <p className="text-sm text-fg-subtle">
          Escribí tu email. Si existe una cuenta, te mandamos un link para elegir una contraseña
          nueva.
        </p>
      </div>
      {sent ? (
        <p role="status" className="text-sm text-success">
          Si el email existe, te va a llegar un link en unos minutos.
        </p>
      ) : (
        <form action={forgotPassword} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className="min-h-11 w-full rounded-control border-2 border-line-control bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-subtle focus-visible:border-focus aria-invalid:border-danger-strong"
            />
          </label>
          <button
            type="submit"
            className="mt-2 inline-flex min-h-12 items-center justify-center pressable edge-6 rounded-pill border-edge-brand bg-brand px-4 text-base font-extrabold text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Mandar link
          </button>
        </form>
      )}
      <a href="/login" className="text-sm text-fg-subtle underline">
        Volver al login
      </a>
    </main>
  );
}
