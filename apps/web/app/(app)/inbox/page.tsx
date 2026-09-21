import Link from "next/link";
import { inboxVolume, listInbox, parseInboxView, type InboxView } from "@/lib/inbox-list";
import { formatDate } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { EmailActions } from "./email-actions";

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
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const userId = await requireUserId();
  const view = parseInboxView((await searchParams).vista);
  const [{ rows, counts }, volume] = await Promise.all([
    listInbox(userId, view),
    inboxVolume(userId),
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

      {volume.level === "alto" ? (
        <div role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
              <p className="truncate font-medium text-zinc-900">{r.subject ?? "(sin asunto)"}</p>
              <p className="truncate text-xs text-zinc-600">
                {r.from} · {formatDate(r.receivedAt.toISOString())} · parser {r.parser ?? "none"} ·{" "}
                {r.jobs ?? 0} avisos
                {r.dismissed ? " · no me sirve" : r.seen ? " · visto" : ""}
              </p>
              {r.error ? (
                <p className="mt-1 text-xs text-amber-900">
                  {r.error}{" "}
                  <Link href="/jobs/new" className="underline">
                    cargar a mano
                  </Link>
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
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
