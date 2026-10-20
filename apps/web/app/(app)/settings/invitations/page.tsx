import { canCreateInvitations, listInvitations } from "@/lib/invitations";
import { requireUserId } from "@/lib/session";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { listWaitlist, WaitlistNotEnabledInDbError } from "@/lib/waitlist-admin";
import { revokeInvitationAction } from "./actions";
import { CreateInvitationForm } from "./create-form";
import { WaitlistRow } from "./waitlist-row";

export const metadata = { title: "Invitaciones" };
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
  // Admin en la app pero sin fila en app_admins: la base rechaza la lista; se avisa en vez de romper
  const loaded = isAdmin
    ? await listWaitlist(userId).catch((error: unknown) => {
        if (error instanceof WaitlistNotEnabledInDbError) return null;
        throw error;
      })
    : [];
  const waitlistEnabled = loaded !== null;
  const waitlist = loaded ?? [];

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

      {isAdmin && !waitlistEnabled ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Tu cuenta es admin en la app pero falta habilitarla en la base (ver docs del PR).
        </section>
      ) : null}

      {isAdmin && waitlistEnabled ? (
        <section className="flex flex-col gap-2" aria-labelledby="waitlist-heading">
          <h2 id="waitlist-heading" className="text-lg font-medium">
            Lista de espera ({waitlist.filter((w) => !w.invitedAt).length} sin invitar)
          </h2>
          <p className="text-sm text-zinc-600">
            No se manda ningún email: copiá el link y enviáselo vos.
          </p>
          {waitlist.length === 0 ? (
            <p className="text-sm text-zinc-600">Nadie se anotó todavía.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200">
              {waitlist.map((w) => (
                <WaitlistRow
                  key={w.id}
                  entry={{
                    id: w.id,
                    name: w.name,
                    email: w.email,
                    roleLabel:
                      (ROLE_SKILLS as Record<string, { label: string } | undefined>)[w.role]
                        ?.label ?? w.role,
                    heardFrom: w.heardFrom,
                    createdLabel: DATE.format(w.createdAt),
                    invitedLabel: w.invitedAt ? DATE.format(w.invitedAt) : null,
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
