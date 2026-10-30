import { PRODUCT_NAME } from "@job-search-os/pipeline";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { SubmitButton } from "@/app/components/submit-button";
import { MAX_PASSWORD_LENGTH } from "@/lib/invitations-core";
import { createFirstUser, hasAnyUser } from "@/lib/setup";

// Sin esto, Next puede congelar esta página como estática en el build si en ese momento
// hasAnyUser() da true (el redirect corre antes de tocar searchParams): el gate quedaría
// fijo para siempre según el estado de la base al buildear, no en cada visita.
export const dynamic = "force-dynamic";

export const metadata = { title: "Primer usuario" };

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

const ERROR_MESSAGE: Record<string, string> = {
  corta: `La contraseña tiene que tener entre 8 y ${MAX_PASSWORD_LENGTH} caracteres.`,
  no_coincide: "Las contraseñas no coinciden.",
  email: "Ese email no es válido o ya hay un usuario creado.",
};

/** Crea EL usuario cuando todavía no hay ninguno (JS-045/ADR-012); server action sin JS de cliente. */
async function setup(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  // S-3: con tope, para que un texto enorme no pase por scrypt
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) redirect("/setup?error=corta");
  if (password !== confirm) redirect("/setup?error=no_coincide");
  try {
    await createFirstUser(email, password);
  } catch {
    redirect("/setup?error=email");
  }
  try {
    await signIn("credentials", { email, password, redirectTo: "/hoy" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    throw error; // NEXT_REDIRECT y errores reales siguen su curso
  }
}

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await hasAnyUser()) redirect("/login");
  const { error } = await searchParams;
  const invalidProps = (key: string) =>
    error === key ? { "aria-invalid": true, "aria-describedby": "setup-error" } : {};
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
        <p className="text-sm text-fg-subtle">
          Todavía no hay ningún usuario. Creá el único usuario de la app.
        </p>
      </div>
      <form action={setup} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            {...invalidProps("email")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            {...invalidProps("corta")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Repetila
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            {...invalidProps("no_coincide")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
        </label>
        {error ? (
          <p id="setup-error" role="alert" className="text-sm text-danger">
            {ERROR_MESSAGE[error] ?? "No se pudo crear el usuario."}
          </p>
        ) : null}
        <SubmitButton
          pendingLabel="Creando la cuenta…"
          className="mt-2 rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast"
        >
          Crear cuenta
        </SubmitButton>
      </form>
    </main>
  );
}
