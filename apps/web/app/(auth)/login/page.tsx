import { PRODUCT_NAME } from "@job-search-os/pipeline";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { SubmitButton } from "@/app/components/submit-button";
import { hasAnyUser } from "@/lib/setup";

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
      <a href="#contenido" className={SKIP_CLASS}>
        Saltar al contenido
      </a>
      <div>
        <h1 className="text-2xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="text-sm text-fg-subtle">Entrá con tu email y contraseña.</p>
      </div>
      <form action={login} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-control border border-line-strong px-3 py-2 text-base"
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
          className="mt-2 rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast"
        >
          Entrar
        </SubmitButton>
      </form>
      <a href="/forgot-password" className="text-sm text-fg-subtle underline">
        Olvidé mi contraseña
      </a>
    </main>
  );
}
