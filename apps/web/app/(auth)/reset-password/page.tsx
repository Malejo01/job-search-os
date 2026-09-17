import { redirect } from "next/navigation";
import { checkResetToken, resetPassword } from "@/lib/password-reset";

// Ver la nota en /setup: nunca dejar que Next congele una página que depende de estado en vivo.
export const dynamic = "force-dynamic";

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
  if (password.length < 8) {
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

  const formError =
    error === "corta"
      ? "La contraseña tiene que tener al menos 8 caracteres."
      : error === "no_coincide"
        ? "Las contraseñas no coinciden."
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Elegir contraseña nueva</h1>
      </div>
      {!check.ok ? (
        <p role="alert" className="text-sm text-red-700">
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
          {formError ? (
            <p role="alert" className="text-sm text-red-700">
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
          >
            Guardar
          </button>
        </form>
      )}
      <a href="/forgot-password" className="text-sm text-zinc-600 underline">
        Pedir un link nuevo
      </a>
    </main>
  );
}
