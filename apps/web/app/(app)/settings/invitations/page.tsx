import {
  clampInviteCap,
  countWaitlistByRole,
  filterWaitlist,
  INVITE_CAP_MAX,
  ORIGIN_NONE,
  originOptions,
  parseWaitlistFilters,
  type WaitlistFilters,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { canCreateInvitations, listInvitations } from "@/lib/invitations";
import { requireUserId } from "@/lib/session";
import { ROLE_SKILLS } from "@/lib/skill-levels";
import { listWaitlist, WaitlistNotEnabledInDbError } from "@/lib/waitlist-admin";
import { revokeInvitationAction } from "./actions";
import { CreateInvitationForm } from "./create-form";
import { WaitlistPanel } from "./waitlist-panel";

export const metadata = { title: "Invitaciones" };
export const dynamic = "force-dynamic";
// Invitar en tanda crea de a una invitación (hasta 100): le damos margen a la acción
export const maxDuration = 60;

const STATUS_LABEL = { pendiente: "Pendiente", usada: "Usada", vencida: "Vencida" } as const;

const DATE = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" });

const ROLE_LABELS = ROLE_SKILLS as Record<string, { label: string } | undefined>;
const roleLabel = (role: string) => ROLE_LABELS[role]?.label ?? role;

/** Query string de los filtros (para los links de carrera y para exportar). */
function filterQuery(filters: WaitlistFilters, override: Partial<WaitlistFilters> = {}): string {
  const f = { ...filters, ...override };
  const q = new URLSearchParams();
  if (f.role) q.set("carrera", f.role);
  if (f.origin) q.set("origen", f.origin);
  if (f.from) q.set("desde", f.from);
  if (f.to) q.set("hasta", f.to);
  if (f.status) q.set("estado", f.status);
  const text = q.toString();
  return text ? `?${text}` : "";
}

/**
 * Invitaciones del usuario (JS-091): lista, alta y revocación. El código en claro no se guarda.
 * Para quien administra, además, la lista de espera con filtros, contadores, invitación en tanda y CSV (C4-2).
 */
export default async function InvitationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseWaitlistFilters(await searchParams);
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Invitaciones</h1>
      <p className="text-sm text-fg-subtle">
        Cada invitación sirve una sola vez y vence a los 14 días.
      </p>

      <section className="rounded-card border border-line p-4">
        {isAdmin ? (
          <CreateInvitationForm />
        ) : (
          <p className="text-sm text-fg-muted">
            Tu cuenta no puede crear invitaciones: es una función de administración.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Tus invitaciones</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-fg-subtle">Todavía no creaste ninguna.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{STATUS_LABEL[inv.status]}</span>
                  <span className="text-fg-subtle">
                    {inv.email ?? "Cualquier email"} · creada {DATE.format(inv.createdAt)}
                    {inv.status === "usada" && inv.usedAt
                      ? ` · usada ${DATE.format(inv.usedAt)}`
                      : ` · vence ${DATE.format(inv.expiresAt)}`}
                  </span>
                </div>
                {inv.status !== "usada" ? (
                  <form action={revokeInvitationAction}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button
                      type="submit"
                      className="rounded-control border border-line-strong px-3 py-1"
                    >
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
        <section className="rounded-control border border-warning-line bg-warning-soft p-4 text-sm text-warning">
          Tu cuenta es admin en la app pero falta habilitarla en la base (ver docs del PR).
        </section>
      ) : null}

      {isAdmin && waitlistEnabled ? (
        <WaitlistSection waitlist={waitlist} filters={filters} />
      ) : null}
    </div>
  );
}

type Entries = Awaited<ReturnType<typeof listWaitlist>>;

function WaitlistSection({ waitlist, filters }: { waitlist: Entries; filters: WaitlistFilters }) {
  const pendingTotal = waitlist.filter((w) => !w.invitedAt).length;
  const visible = filterWaitlist(waitlist, filters);
  // Los contadores por carrera respetan el resto de los filtros, pero no el de carrera: así se puede cambiar de una a otra
  const roleCounts = countWaitlistByRole(filterWaitlist(waitlist, { ...filters, role: undefined }));
  const origins = originOptions(waitlist);
  const hasFilters = Object.keys(filters).length > 0;
  const defaultCap = clampInviteCap(undefined, process.env.WAITLIST_INVITE_CAP);
  const fieldClass =
    "min-h-11 rounded-control border border-line-control bg-surface px-3 py-2 text-base";

  return (
    <section className="flex flex-col gap-4" aria-labelledby="waitlist-heading">
      <h2 id="waitlist-heading" className="text-lg font-medium">
        Lista de espera ({pendingTotal} sin invitar)
      </h2>
      <p className="text-sm text-fg-subtle">
        No se manda ningún email: al invitar copiás el mensaje y lo enviás vos.
      </p>
      {waitlist.length >= 500 ? (
        <p className="text-sm text-warning">
          Se muestran las 500 personas más recientes; si hay más, no entran en los filtros ni en el
          CSV.
        </p>
      ) : null}

      {roleCounts.length > 0 ? (
        <nav aria-label="Personas por carrera" data-testid="waitlist-counters">
          <ul className="flex flex-wrap gap-2">
            {roleCounts.map((c) => {
              const active = filters.role === c.role;
              return (
                <li key={c.role}>
                  <Link
                    href={`/settings/invitations${filterQuery(filters, { role: active ? undefined : c.role })}#waitlist-heading`}
                    aria-current={active ? "true" : undefined}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-pill border px-3 text-sm ${
                      active
                        ? "border-brand bg-brand text-brand-contrast"
                        : "border-line-strong bg-surface text-fg"
                    }`}
                  >
                    {roleLabel(c.role)}
                    <span className="font-medium" title="sin invitar de un total">
                      {c.pending}
                      <span className="font-normal opacity-80"> de {c.total}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      <form
        method="get"
        action="/settings/invitations"
        className="grid gap-3 rounded-card border border-line p-3 text-sm sm:grid-cols-2"
        data-testid="waitlist-filters"
      >
        <label className="flex flex-col gap-1">
          Carrera
          <select name="carrera" defaultValue={filters.role ?? ""} className={fieldClass}>
            <option value="">Todas</option>
            {countWaitlistByRole(waitlist).map((c) => (
              <option key={c.role} value={c.role}>
                {roleLabel(c.role)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Cómo se enteró
          <select name="origen" defaultValue={filters.origin ?? ""} className={fieldClass}>
            <option value="">Cualquiera</option>
            <option value={ORIGIN_NONE}>Sin dato</option>
            {origins.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label} ({o.count})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Se anotó desde
          <input
            type="date"
            name="desde"
            defaultValue={filters.from ?? ""}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          Se anotó hasta
          <input type="date" name="hasta" defaultValue={filters.to ?? ""} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1">
          Estado
          <select name="estado" defaultValue={filters.status ?? "todas"} className={fieldClass}>
            <option value="todas">Todas</option>
            <option value="sin_invitar">Sin invitar</option>
            <option value="invitadas">Ya invitadas</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-control bg-brand px-4 py-2 font-medium text-brand-contrast"
          >
            Filtrar
          </button>
          {hasFilters ? (
            <Link
              href="/settings/invitations#waitlist-heading"
              className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4"
            >
              Limpiar filtros
            </Link>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <p role="status">
          {visible.length === waitlist.length
            ? `${visible.length} ${visible.length === 1 ? "persona" : "personas"}`
            : `${visible.length} de ${waitlist.length} personas`}
        </p>
        {visible.length > 0 ? (
          <a
            href={`/settings/invitations/export${filterQuery(filters)}`}
            download
            className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-4 text-fg"
          >
            Exportar a CSV ({visible.length})
          </a>
        ) : null}
      </div>

      {waitlist.length === 0 ? (
        <p className="text-sm text-fg-subtle">Nadie se anotó todavía.</p>
      ) : (
        <WaitlistPanel
          entries={visible.map((w) => ({
            id: w.id,
            name: w.name,
            email: w.email,
            roleLabel: roleLabel(w.role),
            heardFrom: w.heardFrom,
            createdLabel: DATE.format(w.createdAt),
            invitedLabel: w.invitedAt ? DATE.format(w.invitedAt) : null,
          }))}
          defaultCap={defaultCap}
          maxCap={INVITE_CAP_MAX}
        />
      )}
    </section>
  );
}
