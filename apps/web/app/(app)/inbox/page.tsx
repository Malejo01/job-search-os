import Link from "next/link";
import { isWebmailDomain } from "@job-search-os/pipeline";
import {
  cleanDomain,
  emailIdsOfDomain,
  filterLeaks,
  webmailErrorFromParams,
} from "@/lib/filter-leak";
import {
  inboxVolume,
  listInbox,
  parseInboxView,
  pendingGmailConfirmation,
  type InboxView,
} from "@/lib/inbox-list";
import { getInboundAddress } from "@/lib/inbound-address";
import { formatDate, inboundErrorLabel, parserLabel } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import {
  Alert,
  buttonClasses,
  cardClasses,
  filterChipClasses,
  textLinkClasses,
} from "@/components/ui";
import { markSeenAction } from "./actions";
import { BulkBar } from "./bulk-bar";
import { DeleteDomainButton } from "./delete-domain-button";
import { EmailActions } from "./email-actions";
import { senderVerdictAction } from "./leak-actions";

export const metadata = { title: "Emails entrantes" };
export const dynamic = "force-dynamic";

const TABS: { view: InboxView; label: string }[] = [
  { view: "pendientes", label: "Pendientes" },
  { view: "vistos", label: "Vistos" },
  { view: "descartados", label: "Descartados" },
  { view: "todos", label: "Todos" },
];

const SECONDARY_SM = buttonClasses({ variant: "secondary", size: "sm" });

const EMPTY: Record<InboxView, string> = {
  pendientes: "No hay emails pendientes de revisar.",
  vistos: "Todavía no hay emails vistos ni resueltos automáticamente.",
  descartados: "No descartaste ningún email.",
  todos: "Todavía no llegó ningún email. Reenviá las alertas a tu dirección de ingesta.",
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
  searchParams: Promise<{ vista?: string; dominio?: string; error?: string; sender?: string }>;
}) {
  const userId = await requireUserId();
  const params = await searchParams;
  const webmailError = webmailErrorFromParams(params);
  const view = parseInboxView(params.vista);
  // "Ver" desde el aviso de fuga: solo los emails de ese dominio (JS-048)
  const domain = params.dominio ? cleanDomain(params.dominio) : null;
  const only = domain ? await emailIdsOfDomain(userId, domain) : undefined;
  const [{ rows, counts }, volume, leaks, address, gmail] = await Promise.all([
    listInbox(userId, view, only),
    inboxVolume(userId),
    filterLeaks(userId),
    getInboundAddress(userId),
    pendingGmailConfirmation(userId),
  ]);

  return (
    <section className="flex flex-col gap-5">
      {webmailError ? (
        <Alert tone="danger" role="alert" bordered data-testid="error-webmail">
          {webmailError}
        </Alert>
      ) : null}
      {/* Arriba de todo, hasta que se marque como visto */}
      {gmail ? (
        <div
          role="region"
          aria-label="Confirmación del reenvío de Gmail"
          className={cardClasses({
            tone: "info",
            padding: "md",
            className: "flex flex-col gap-2 text-sm text-info",
          })}
        >
          <p className="font-bold">Confirmá el reenvío de Gmail</p>
          <p className="text-xs">
            Gmail mandó el pedido de confirmación a tu dirección de ingesta. Confirmalo para que
            empiece a reenviar tus alertas.
          </p>
          <p className="text-xs">
            {gmail.requester ? (
              <>
                Lo pidió <span className="font-medium">{gmail.requester}</span>. Confirmá solo si es
                tu cuenta de Gmail.
              </>
            ) : (
              "Confirmá solo si vos pediste este reenvío."
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {gmail.link ? (
              <a
                href={gmail.link}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClasses({ size: "sm" })}
              >
                Confirmar reenvío
              </a>
            ) : (
              <>
                <span>Abrí el email para confirmarlo.</span>
                <Link href={`/inbox/${gmail.id}`} className={textLinkClasses({ block: true })}>
                  Abrir el email
                </Link>
              </>
            )}
            <form action={markSeenAction}>
              <input type="hidden" name="id" value={gmail.id} />
              <button type="submit" className={SECONDARY_SM}>
                Ya lo confirmé
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-title font-bold">Emails entrantes</h1>
        <p className="text-xs text-fg-subtle">
          {volume.last24h} en 24 h · {volume.last24hNoParser} sin poder leer en 24 h · promedio{" "}
          {volume.averagePerDay}/día
          {volume.rejectedLast24h ? ` · ${volume.rejectedLast24h} rechazados` : ""}
        </p>
      </div>

      {leaks.length ? (
        <Alert
          tone="danger"
          role="alert"
          bordered
          aria-label="Posible fuga del filtro de reenvío"
          title="Posible fuga del filtro de reenvío"
        >
          <p className="text-xs">
            Llegaron emails de dominios que nunca se habían visto y que no son fuentes de empleo.
            Revisá el filtro de Gmail: puede estar reenviando correo personal.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {leaks.map((l) => (
              <li
                key={l.domain}
                className="flex flex-wrap items-center gap-2 rounded-control bg-surface px-3 py-2 text-xs text-fg"
              >
                <span className="font-bold">{l.domain}</span>
                <span className="rounded-badge bg-danger-muted px-2.5 py-0.5 font-bold text-danger">
                  {l.category ?? "dominio nuevo"}
                </span>
                <span>
                  {l.recent} {l.recent === 1 ? "email" : "emails"} desde{" "}
                  {formatDate(l.firstAt.toISOString())}
                </span>
                <Link
                  href={`/inbox?vista=todos&dominio=${encodeURIComponent(l.domain)}`}
                  className={textLinkClasses({ block: true })}
                >
                  Ver
                </Link>
                {isWebmailDomain(l.domain) ? (
                  <span className="text-fg-muted">
                    Correo personal: no se puede marcar como fuente
                  </span>
                ) : (
                  <form action={senderVerdictAction}>
                    <input type="hidden" name="domain" value={l.domain} />
                    <input type="hidden" name="verdict" value="empleo" />
                    <input type="hidden" name="back" value="/inbox" />
                    <button type="submit" className={SECONDARY_SM}>
                      Es fuente de empleo
                    </button>
                  </form>
                )}
                <form action={senderVerdictAction}>
                  <input type="hidden" name="domain" value={l.domain} />
                  <input type="hidden" name="verdict" value="no_empleo" />
                  <button type="submit" className={SECONDARY_SM}>
                    No es de empleo
                  </button>
                </form>
                <DeleteDomainButton domain={l.domain} total={l.recent} />
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {volume.level === "alto" ? (
        <Alert
          tone="warning"
          role="alert"
          aria-label="Volumen fuera de lo normal"
          title="Volumen fuera de lo normal"
        >
          <ul className="mt-1 list-disc pl-5 text-xs">
            {volume.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* C9-11: pestañas como filtros (la activa en lima con borde índigo). El padding deja ver el
          anillo de foco y el borde de abajo dentro del scroll horizontal */}
      <nav aria-label="Vistas" className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto p-1">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "pendientes" ? "/inbox" : `/inbox?vista=${t.view}`}
            aria-current={view === t.view ? "page" : undefined}
            className={filterChipClasses({
              selected: view === t.view,
              className: "shrink-0 whitespace-nowrap",
            })}
          >
            {t.label} ({counts[t.view]})
          </Link>
        ))}
      </nav>

      {domain ? (
        <p className="rounded-control bg-surface px-4 py-3 text-xs text-fg-muted">
          Solo emails de <span className="font-bold">{domain}</span> ·{" "}
          <Link
            href={view === "pendientes" ? "/inbox" : `/inbox?vista=${view}`}
            className={textLinkClasses()}
          >
            ver todos
          </Link>
        </p>
      ) : null}

      <BulkBar total={only ? rows.length : counts[view]} shown={rows.length} view={view} />

      {rows.length === 0 ? (
        <p className="rounded-container bg-surface px-6 py-8 text-center text-sm text-fg-muted">
          {EMPTY[view]}
          {counts.todos === 0 && address ? (
            <>
              <br />
              Tu dirección: <span className="font-mono text-fg select-all">{address}</span>
              <br />
              <Link href="/settings" className={textLinkClasses()}>
                Cómo reenviar desde Gmail, en Ajustes
              </Link>
            </>
          ) : null}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className={`rounded-card bg-surface p-4 text-sm ${
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
                <p className="min-w-0 truncate font-bold text-fg">{r.subject ?? "(sin asunto)"}</p>
              </div>
              <p className="truncate pl-6 text-xs text-fg-subtle">
                {r.from} · {formatDate(r.receivedAt.toISOString())} · {parserLabel(r.parser)} ·{" "}
                {r.jobs ?? 0} avisos
                {r.dismissed ? " · no me sirve" : r.seen ? " · visto" : ""}
              </p>
              {r.error ? (
                <p className="mt-1 pl-6 text-xs text-warning">
                  {inboundErrorLabel(r.error)}{" "}
                  <Link href="/jobs/new" className="font-semibold underline underline-offset-2">
                    cargar a mano
                  </Link>
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-xs">
                <Link href={`/inbox/${r.id}`} className={textLinkClasses({ block: true })}>
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
