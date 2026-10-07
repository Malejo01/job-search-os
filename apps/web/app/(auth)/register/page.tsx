import { redirect } from "next/navigation";
import {
  InvalidInvitationError,
  InvalidRegistrationError,
  registerWithInvitation,
} from "@/lib/invitations";
import { INVALID_INVITATION_MESSAGE } from "@/lib/invitations-core";
import { LegalPage } from "@/lib/legal";

export const dynamic = "force-dynamic";

// El código viaja en ?code=: que no salga en el Referer hacia ningún otro sitio.
export const metadata = { referrer: "no-referrer" } as const;

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
 */
async function register(formData: FormData): Promise<void> {
  "use server";
  const code = String(formData.get("code") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const name = String(formData.get("name") ?? "");
  const back = `/register?code=${encodeURIComponent(code)}`;
  if (password !== confirm) redirect(`${back}&error=no_coincide`);
  try {
    await registerWithInvitation({ code, email, password, name }, formData.get("terms"));
  } catch (error) {
    if (error instanceof InvalidInvitationError) redirect(`${back}&error=invitacion`);
    if (error instanceof InvalidRegistrationError) {
      redirect(
        `${back}&error=${{ password: "corta", name: "nombre", email: "email", terminos: "terminos" }[error.reason]}`,
      );
    }
    throw error;
  }
  redirect("/register?done=1");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; done?: string }>;
}) {
  const { code, error, done } = await searchParams;
  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
        <h1 className="text-2xl font-semibold">Cuenta creada</h1>
        <p className="text-sm text-emerald-700">Ya podés entrar con tu email y tu contraseña.</p>
        <a
          href="/login"
          className="rounded-md bg-zinc-900 px-4 py-2 text-center text-base font-medium text-white"
        >
          Ir a entrar
        </a>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Job Search OS</h1>
        <p className="text-sm text-zinc-600">Creá tu cuenta con tu invitación.</p>
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nombre (opcional)
          <input
            name="name"
            type="text"
            autoComplete="name"
            maxLength={100}
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
          />
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
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
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
          />
        </label>
        <details className="rounded-md border border-zinc-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Leer los términos</summary>
          <div className="mt-3">
            <LegalPage name="terminos" />
          </div>
        </details>
        <details className="rounded-md border border-zinc-200 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Leer la política de privacidad</summary>
          <div className="mt-3">
            <LegalPage name="privacidad" />
          </div>
        </details>
        <label className="flex items-start gap-2 text-sm">
          <input name="terms" type="checkbox" required className="mt-1 h-4 w-4" />
          <span>Leí y acepto los términos y la política de privacidad.</span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {ERROR_MESSAGE[error] ?? "No se pudo crear la cuenta."}
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
        >
          Crear cuenta
        </button>
      </form>
      <a href="/login" className="text-sm text-zinc-600 underline">
        Ya tengo cuenta
      </a>
    </main>
  );
}
