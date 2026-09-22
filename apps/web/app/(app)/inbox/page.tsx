import Link from "next/link";
import { cleanDomain, emailIdsOfDomain, filterLeaks } from "@/lib/filter-leak";
import { inboxVolume, listInbox, parseInboxView, type InboxView } from "@/lib/inbox-list";
import { formatDate, parserLabel } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { BulkBar } from "./bulk-bar";
import { DeleteDomainButton } from "./delete-domain-button";
import { EmailActions } from "./email-actions";
import { senderVerdictAction } from "./leak-actions";

export const dynamic = "force-dynamic";

const TABS: { view: InboxView; label: string }[] = [
  { view: "pendientes", label: "Pendientes" },
  { view: "vistos", label: "Vistos" },
  { view: "descartados", label: "Descartados" },
  { view: "todos", label: "Todos" },
];

const EMPTY: Record<InboxView, string> = {
  pendientes: "No hay emails pendientes de revisar.",
  vistos: "Todavía no marcaste ningún email como visto.",
  descartados: "No descartaste ningún email.",
  todos:
    "Todavía no llegó ningún email. Reenviá las alertas a tu dirección de ingesta (perfil › inbound_address).",
};

/**
 * Emails entrantes (JS-020, JS-038): lo que llegó a ingest.<dominio>, qué parser lo tomó y qué
 * pasó. Por defecto se ven los pendientes; "visto" y "no me sirve" los sacan de esa vista sin
 * borrarlos. Arriba, el volumen de las últimas 24 h y un aviso si algo se sale de lo normal.
 * Con las casillas se actúa en lote sobre los emails de la pestaña (JS-049). Aparte del volumen,
 * avisa si llega un dominio nunca visto que no es fuente de empleo: posible fuga del filtro de
 * reenvío (JS-048).
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; dominio?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const view = parseInboxView(params.vista);
  // "Ver" desde el aviso de fuga: solo los emails de ese dominio (JS-048)
  const domain = params.dominio ? cleanDomain(params.dominio) : null;
  const only = domain ? await emailIdsOfDomain(userId, domain) : undefined;
  const [{ rows, counts }, volume, leaks] = await Promise.all([
    listInbox(userId, view, only),
    inboxVolume(userId),
    filterLeaks(userId),
  ]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Emails entrantes</h1>
        <p className="text-xs text-zinc-500">
          {volume.last24h} en 24 h · {volume.last24hNoParser} sin parser · promedio{" "}
          {volume.averagePerDay}/día
          {volume.rejectedLast24h ? ` · ${volume.rejectedLast24h} rechazados` : ""}
        </p>
      </div>

      {leaks.length ? (
        <div
          role="alert"
          aria-label="Posible fuga del filtro de reenvío"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <p className="font-medium">Posible fuga del filtro de reenvío</p>
          <p className="text-xs">
            Llegaron emails de dominios que nunca se habían visto y que no son fuentes de empleo.
            Revisá el filtro de Gmail: puede estar reenviando correo personal.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {leaks.map((l) => (
              <li
                key={l.domain}
                className="flex flex-wrap items-center gap-2 rounded bg-white/70 px-2 py-1.5 text-xs"
              >
                <span className="font-medium">{l.domain}</span>
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-900">
                  {l.category ?? "dominio nuevo"}
                </span>
                <span>
                  {l.recent} {l.recent === 1 ? "email" : "emails"} desde{" "}
                  {formatDate(l.firstAt.toISOString())}
                </span>
                <Link
                  href={`/inbox?vista=todos&dominio=${encodeURIComponent(l.domain)}`}
                  className="text-blue-700 underline"
                >
                  Ver
                </Link>
                <form action={senderVerdictAction}>
                  <input type="hidden" name="domain" value={l.domain} />
                  <input type="hidden" name="verdict" value="empleo" />
                  <button
                    type="submit"
                    className="rounded border border-zinc-300 bg-white px-2 py-1"
                  >
                    Es fuente de empleo
                  </button>
                </form>
                <form action={senderVerdictAction}>
                  <input type="hidden" name="domain" value={l.domain} />
                  <input type="hidden" name="verdict" value="no_empleo" />
                  <button
                    type="submit"
                    className="rounded border border-zinc-300 bg-white px-2 py-1"
                  >
                    No es de empleo
                  </button>
                </form>
                <DeleteDomainButton domain={l.domain} total={l.recent} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {volume.level === "alto" ? (
        <div
          role="alert"
          aria-label="Volumen fuera de lo normal"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <p className="font-medium">Volumen fuera de lo normal</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {volume.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <nav aria-label="Vistas" className="flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "pendientes" ? "/inbox" : `/inbox?vista=${t.view}`}
            aria-current={view === t.view ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 ${
              view === t.view ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            {t.label} ({counts[t.view]})
          </Link>
        ))}
      </nav>

      {domain ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-700">
          Solo emails de <span className="font-medium">{domain}</span> ·{" "}
          <Link
            href={view === "pendientes" ? "/inbox" : `/inbox?vista=${view}`}
            className="underline"
          >
            ver todos
          </Link>
        </p>
      ) : null}

      <BulkBar total={only ? rows.length : counts[view]} shown={rows.length} />

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          {EMPTY[view]}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`rounded-lg border border-zinc-200 bg-white p-3 text-sm ${
                r.dismissed || r.seen ? "opacity-75" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                {/* Selección múltiple (JS-049): la lee BulkBar desde el DOM */}
                <input
                  type="checkbox"
                  data-inbox-select=""
                  value={r.id}
                  aria-label={`Seleccionar «${r.subject ?? "(sin asunto)"}»`}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <p className="min-w-0 truncate font-medium text-zinc-900">
                  {r.subject ?? "(sin asunto)"}
                </p>
              </div>
              <p className="truncate pl-6 text-xs text-zinc-600">
                {r.from} · {formatDate(r.receivedAt.toISOString())} · {parserLabel(r.parser)} ·{" "}
                {r.jobs ?? 0} avisos
                {r.dismissed ? " · no me sirve" : r.seen ? " · visto" : ""}
              </p>
              {r.error ? (
                <p className="mt-1 pl-6 text-xs text-amber-900">
                  {r.error}{" "}
                  <Link href="/jobs/new" className="underline">
                    cargar a mano
                  </Link>
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-xs">
                <Link href={`/inbox/${r.id}`} className="text-blue-700 underline">
                  Ver contenido
                </Link>
                <EmailActions id={r.id} subject={r.subject} seen={r.seen} dismissed={r.dismissed} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
