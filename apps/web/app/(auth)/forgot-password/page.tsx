import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/password-reset";

// Ver la nota en /setup: nunca dejar que Next congele una página que depende de estado en vivo.
export const dynamic = "force-dynamic";

/** Pide el link de recuperación (JS-045); server action sin JS de cliente. */
async function forgotPassword(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  await requestPasswordReset(email, `${proto}://${host}`);
  redirect("/forgot-password?sent=1");
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Olvidé mi contraseña</h1>
        <p className="text-sm text-zinc-600">
          Escribí tu email. Si existe una cuenta, te mandamos un link para elegir una contraseña
          nueva.
        </p>
      </div>
      {sent ? (
        <p role="status" className="text-sm text-emerald-700">
          Si el email existe, te va a llegar un link en unos minutos.
        </p>
      ) : (
        <form action={forgotPassword} className="flex flex-col gap-3">
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
          <button
            type="submit"
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
          >
            Mandar link
          </button>
        </form>
      )}
      <a href="/login" className="text-sm text-zinc-600 underline">
        Volver al login
      </a>
    </main>
  );
}
