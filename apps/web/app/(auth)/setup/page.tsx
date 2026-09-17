import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { createFirstUser, hasAnyUser } from "@/lib/setup";

// Sin esto, Next puede congelar esta página como estática en el build si en ese momento
// hasAnyUser() da true (el redirect corre antes de tocar searchParams): el gate quedaría
// fijo para siempre según el estado de la base al buildear, no en cada visita.
export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  corta: "La contraseña tiene que tener al menos 8 caracteres.",
  no_coincide: "Las contraseñas no coinciden.",
  email: "Ese email no es válido o ya hay un usuario creado.",
};

/** Crea EL usuario cuando todavía no hay ninguno (JS-045/ADR-012); server action sin JS de cliente. */
async function setup(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) redirect("/setup?error=corta");
  if (password !== confirm) redirect("/setup?error=no_coincide");
  try {
    await createFirstUser(email, password);
  } catch {
    redirect("/setup?error=email");
  }
  try {
    await signIn("credentials", { email, password, redirectTo: "/jobs" });
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
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Job Search OS</h1>
        <p className="text-sm text-zinc-600">
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
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {ERROR_MESSAGE[error] ?? "No se pudo crear el usuario."}
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
        >
          Crear cuenta
        </button>
      </form>
    </main>
  );
}
