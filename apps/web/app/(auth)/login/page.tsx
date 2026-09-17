import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { hasAnyUser } from "@/lib/setup";

// Igual que /setup: el gate hacia /setup depende de una lectura de la base en cada visita.
export const dynamic = "force-dynamic";

/** Login con email + contraseña (Server Action; sin JS de cliente). Un solo usuario, sin registro. */
async function login(formData: FormData): Promise<void> {
  "use server";
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/jobs",
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Job Search OS</h1>
        <p className="text-sm text-zinc-600">Entrá con tu email y contraseña.</p>
      </div>
      <form action={login} className="flex flex-col gap-3">
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
            autoComplete="current-password"
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-base"
          />
        </label>
        {reset ? (
          <p className="text-sm text-emerald-700">Contraseña actualizada. Ya podés entrar.</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            Email o contraseña incorrectos.
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
        >
          Entrar
        </button>
      </form>
      <a href="/forgot-password" className="text-sm text-zinc-600 underline">
        Olvidé mi contraseña
      </a>
    </main>
  );
}
