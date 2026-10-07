import { canCreateInvitations, listInvitations } from "@/lib/invitations";
import { requireUserId } from "@/lib/session";
import { revokeInvitationAction } from "./actions";
import { CreateInvitationForm } from "./create-form";

export const dynamic = "force-dynamic";

const STATUS_LABEL = { pendiente: "Pendiente", usada: "Usada", vencida: "Vencida" } as const;

const DATE = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" });

/** Invitaciones del usuario (JS-091): lista, alta y revocación. El código en claro no se guarda. */
export default async function InvitationsPage() {
  const userId = await requireUserId();
  const [invitations, isAdmin] = await Promise.all([
    listInvitations(userId),
    canCreateInvitations(userId),
  ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Invitaciones</h1>
      <p className="text-sm text-zinc-600">
        Cada invitación sirve una sola vez y vence a los 14 días.
      </p>

      <section className="rounded-md border border-zinc-200 p-4">
        {isAdmin ? (
          <CreateInvitationForm />
        ) : (
          <p className="text-sm text-zinc-700">
            Tu cuenta no puede crear invitaciones: es una función de administración.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Tus invitaciones</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-zinc-600">Todavía no creaste ninguna.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{STATUS_LABEL[inv.status]}</span>
                  <span className="text-zinc-600">
                    {inv.email ?? "Cualquier email"} · creada {DATE.format(inv.createdAt)}
                    {inv.status === "usada" && inv.usedAt
                      ? ` · usada ${DATE.format(inv.usedAt)}`
                      : ` · vence ${DATE.format(inv.expiresAt)}`}
                  </span>
                </div>
                {inv.status !== "usada" ? (
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1">
                      Revocar
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
