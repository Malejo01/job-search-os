import { redirect } from "next/navigation";
import { MAX_PASSWORD_LENGTH } from "@/lib/invitations-core";
import { checkResetToken, resetPassword } from "@/lib/password-reset";

// Ver la nota en /setup: nunca dejar que Next congele una página que depende de estado en vivo.
export const dynamic = "force-dynamic";

export const metadata = { title: "Contraseña nueva" };

const SKIP_CLASS =
  "sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:ring-2 focus:ring-focus";

const REASON_MESSAGE: Record<"invalid" | "expired" | "used", string> = {
  invalid: "El link no es válido.",
  expired: "El link venció. Pedí uno nuevo.",
  used: "Este link ya se usó. Pedí uno nuevo.",
};

/** Confirma la contraseña nueva (JS-045); server action sin JS de cliente. */
async function submitNewPassword(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  // S-3: con tope, para que un texto enorme no pase por scrypt
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=corta`);
  }
  if (password !== confirm) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=no_coincide`);
  }
  const result = await resetPassword(token, password);
  if (!result.ok) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=${result.reason}`);
  }
  redirect("/login?reset=1");
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const check = token
    ? await checkResetToken(token)
    : { ok: false as const, reason: "invalid" as const };

  const invalidProps = (key: string) =>
    error === key ? { "aria-invalid": true, "aria-describedby": "reset-error" } : {};

  const formError =
    error === "corta"
      ? `La contraseña tiene que tener entre 8 y ${MAX_PASSWORD_LENGTH} caracteres.`
      : error === "no_coincide"
        ? "Las contraseñas no coinciden."
        : null;

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
        <h1 className="text-2xl font-semibold">Elegir contraseña nueva</h1>
      </div>
      {!check.ok ? (
        <p role="alert" className="text-sm text-danger">
          {REASON_MESSAGE[check.reason]}
        </p>
      ) : (
        <form action={submitNewPassword} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <label className="flex flex-col gap-1 text-sm">
            Contraseña nueva
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
          {formError ? (
            <p id="reset-error" role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-2 rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast"
          >
            Guardar
          </button>
        </form>
      )}
      <a href="/forgot-password" className="text-sm text-fg-subtle underline">
        Pedir un link nuevo
      </a>
    </main>
  );
}
