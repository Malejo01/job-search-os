import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { withUser } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { deleteAccountAction } from "./actions";

export const dynamic = "force-dynamic";

/** Ajustes de la cuenta (JS-092): email, invitaciones y eliminación de la cuenta. Server Component. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  const { error } = await searchParams;
  const [user] = await withUser(userId, (tx) =>
    tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Ajustes</h1>

      <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
        <h2 className="text-lg font-medium">Cuenta</h2>
        <p className="text-sm text-zinc-700">
          Email: <span className="font-medium">{user?.email ?? "—"}</span>
        </p>
        <Link href="/settings/invitations" className="text-sm text-zinc-900 underline">
          Invitaciones
        </Link>

        <details
          open={Boolean(error)}
          className="rounded-md border border-red-200 bg-red-50/40 p-3"
        >
          <summary className="cursor-pointer text-sm font-medium text-red-800">
            Eliminar mi cuenta
          </summary>
          <div className="mt-3 flex flex-col gap-3 text-sm text-zinc-700">
            <p>
              Se borran tu perfil, criterios, ofertas, evaluaciones, postulaciones, contactos,
              emails recibidos y sus originales, skills, plan de formación, respuestas guardadas, el
              historial de llamadas al modelo y las invitaciones que creaste. Después se borra tu
              usuario y se cierra la sesión.
            </p>
            <p className="font-medium text-red-800">
              Es irreversible: no hay copia ni forma de recuperarla.
            </p>
            {error ? (
              <p role="alert" className="text-red-700">
                El email o la contraseña no coinciden. No se borró nada.
              </p>
            ) : null}
            <form action={deleteAccountAction} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                Escribí tu email para confirmar
                <input
                  name="email"
                  type="email"
                  autoComplete="off"
                  required
                  className="rounded-md border border-zinc-300 px-3 py-2 text-base"
                />
              </label>
              <label className="flex flex-col gap-1">
                Contraseña
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="rounded-md border border-zinc-300 px-3 py-2 text-base"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-red-700 px-4 py-2 text-base font-medium text-white"
              >
                Eliminar mi cuenta para siempre
              </button>
            </form>
          </div>
        </details>
      </section>
    </div>
  );
}
