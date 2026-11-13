import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { SubmitButton } from "@/app/components/submit-button";
import { ClearAssistantProposal } from "@/components/clear-assistant-proposal";
import { hasAnyUser } from "@/lib/setup";
import { Logo } from "@/components/brand/logo";

// Igual que /setup: el gate hacia /setup depende de una lectura de la base en cada visita.
export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar" };

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

/** Login con email + contraseña (Server Action; sin JS de cliente). Un solo usuario, sin registro. */
async function login(formData: FormData): Promise<void> {
  "use server";
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/hoy",
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?error=1");
    throw error; // NEXT_REDIRECT y errores reales siguen su curso
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  if (!(await hasAnyUser())) redirect("/setup");
  const { error, reset } = await searchParams;
  return (
    <main
      id="contenido"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6"
    >
      <ClearAssistantProposal />
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <div>
        <div className="mb-2">
          <Logo size="md" />
        </div>
        <h1 className="mb-1 text-2xl font-semibold">Entrar</h1>
        <p className="text-sm text-fg-subtle">Entrá con tu email y contraseña.</p>
      </div>
      <form action={login} className="flex flex-col gap-3">
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
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Contraseña
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="min-h-11 w-full rounded-control border-2 border-line-control bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-subtle focus-visible:border-focus aria-invalid:border-danger-strong"
          />
        </label>
        {reset ? (
          <p className="text-sm text-success">Contraseña actualizada. Ya podés entrar.</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            Email o contraseña incorrectos.
          </p>
        ) : null}
        <SubmitButton
          pendingLabel="Entrando…"
          className="mt-2 inline-flex min-h-12 items-center justify-center pressable edge-6 rounded-pill border-edge-brand bg-brand px-4 text-base font-extrabold text-brand-contrast hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Entrar
        </SubmitButton>
      </form>
      <div className="flex flex-col gap-2 text-sm text-fg-subtle">
        <a href="/forgot-password" className="underline">
          Olvidé mi contraseña
        </a>
        <p>
          ¿No tenés cuenta?{" "}
          <Link href="/acceso" className="underline">
            Pedir acceso
          </Link>
        </p>
        <Link href="/" className="underline">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
