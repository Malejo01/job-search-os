import { PRODUCT_NAME } from "@job-search-os/pipeline";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import {
  InvalidInvitationError,
  InvalidRegistrationError,
  registerWithInvitation,
} from "@/lib/invitations";
import { INVALID_INVITATION_MESSAGE } from "@/lib/invitations-core";
import { LegalPage } from "@/lib/legal";
import { SubmitButton } from "@/app/components/submit-button";

export const dynamic = "force-dynamic";

// El código viaja en ?code=: que no salga en el Referer hacia ningún otro sitio.
export const metadata = { title: "Crear cuenta", referrer: "no-referrer" } as const;

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

const ERROR_MESSAGE: Record<string, string> = {
  corta: "La contraseña tiene que tener entre 8 y 128 caracteres.",
  no_coincide: "Las contraseñas no coinciden.",
  email: "El email no es válido.",
  nombre: "El nombre es demasiado largo (máximo 100 caracteres).",
  terminos: "Para crear la cuenta tenés que aceptar los términos y la política de privacidad.",
  invitacion: `Hubo un problema: ${INVALID_INVITATION_MESSAGE}.`,
};

/**
 * Alta por invitación (JS-091). Pública: el código (en el link) es lo único que habilita el canje.
 * Los errores del código son siempre el mismo mensaje: no se revela si existe, está usada o vencida.
 * Con la cuenta creada entra sola, igual que el login (C-17, R2: una pantalla y dos campos menos).
 * Si el ingreso falla, cae en «Cuenta creada» y la persona entra a mano.
 */
async function register(formData: FormData): Promise<void> {
  "use server";
  const code = String(formData.get("code") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const name = String(formData.get("name") ?? "");

  const buildBack = (errorKey: string) => {
    const params = new URLSearchParams();
    if (code) params.set("code", code);
    if (email) params.set("email", email);
    if (name) params.set("name", name);
    params.set("error", errorKey);
    return `/register?${params.toString()}`;
  };

  if (password !== confirm) redirect(buildBack("no_coincide"));
  try {
    await registerWithInvitation({ code, email, password, name }, formData.get("terms"));
  } catch (error) {
    if (error instanceof InvalidInvitationError) redirect(buildBack("invitacion"));
    if (error instanceof InvalidRegistrationError) {
      const errMap = {
        password: "corta",
        name: "nombre",
        email: "email",
        terminos: "terminos",
      } as const;
      redirect(buildBack(errMap[error.reason]));
    }
    throw error;
  }
  try {
    await signIn("credentials", { email, password, redirectTo: "/hoy" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/register?done=1");
    throw error; // NEXT_REDIRECT y errores reales siguen su curso
  }
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    error?: string;
    done?: string;
    email?: string;
    name?: string;
  }>;
}) {
  const { code, error, done, email, name } = await searchParams;
  if (done) {
    return (
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6"
      >
        <a href="#contenido" className={SKIP_CLASS}>
          Saltar al contenido
        </a>
        <h1 className="text-2xl font-semibold">Cuenta creada</h1>
        <p className="text-sm text-success">Ya podés entrar con tu email y tu contraseña.</p>
        <a
          href="/login"
          className="rounded-control bg-brand px-4 py-2 text-center text-base font-medium text-brand-contrast"
        >
          Iniciar sesión
        </a>
      </main>
    );
  }
  const invalidProps = (key: string) =>
    error === key ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};
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
        <p className="text-sm text-fg-subtle">Creá tu cuenta con tu invitación.</p>
        {code ? null : (
          <p role="note" className="mt-2 text-sm text-warning">
            Abrí el enlace completo que te enviaron: sin el código de la invitación no se puede
            crear la cuenta.
          </p>
        )}
      </div>
      <form action={register} className="flex flex-col gap-3">
        <input type="hidden" name="code" value={code ?? ""} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            defaultValue={email ?? ""}
            {...invalidProps("email")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
          {error === "email" ? (
            <p id="email-error" role="alert" className="text-xs text-danger">
              {ERROR_MESSAGE.email}
            </p>
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nombre (opcional)
          <input
            name="name"
            type="text"
            autoComplete="name"
            maxLength={100}
            defaultValue={name ?? ""}
            {...invalidProps("nombre")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
          {error === "nombre" ? (
            <p id="nombre-error" role="alert" className="text-xs text-danger">
              {ERROR_MESSAGE.nombre}
            </p>
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            {...invalidProps("corta")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
          {error === "corta" ? (
            <p id="corta-error" role="alert" className="text-xs text-danger">
              {ERROR_MESSAGE.corta}
            </p>
          ) : null}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Repetí la contraseña
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            {...invalidProps("no_coincide")}
            className="rounded-control border border-line-strong px-3 py-2 text-base"
          />
          {error === "no_coincide" ? (
            <p id="no_coincide-error" role="alert" className="text-xs text-danger">
              {ERROR_MESSAGE.no_coincide}
            </p>
          ) : null}
        </label>
        <details className="rounded-control border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium">Leer los términos</summary>
          <div className="mt-3">
            <LegalPage name="terminos" />
          </div>
        </details>
        <details className="rounded-control border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium">Leer la política de privacidad</summary>
          <div className="mt-3">
            <LegalPage name="privacidad" />
          </div>
        </details>
        <div>
          <label className="flex items-start gap-2 text-sm">
            <input
              name="terms"
              type="checkbox"
              required
              {...invalidProps("terminos")}
              className="mt-1 h-4 w-4"
            />
            <span>
              Leí y acepto los{" "}
              <a href="/legal/terminos" target="_blank" rel="noopener" className="underline">
                términos
              </a>{" "}
              y la{" "}
              <a href="/legal/privacidad" target="_blank" rel="noopener" className="underline">
                política de privacidad
              </a>
              .
            </span>
          </label>
          {error === "terminos" ? (
            <p id="terminos-error" role="alert" className="mt-1 text-xs text-danger">
              {ERROR_MESSAGE.terminos}
            </p>
          ) : null}
        </div>
        {error ? (
          <p id="register-error" role="alert" className="text-sm text-danger">
            {ERROR_MESSAGE[error] ?? "No se pudo crear la cuenta."}
            {error === "invitacion" ? " Si te invitaron con otro email, usá ese." : null}
          </p>
        ) : null}
        <SubmitButton
          pendingLabel="Creando la cuenta…"
          className="mt-2 rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast"
        >
          Crear cuenta
        </SubmitButton>
      </form>
      <a href="/login" className="text-sm text-fg-subtle underline">
        Ya tengo cuenta
      </a>
    </main>
  );
}
