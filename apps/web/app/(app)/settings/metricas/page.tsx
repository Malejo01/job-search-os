import {
  CAREER_REVEAL_THRESHOLD,
  CAREER_REVEAL_WINDOW_DAYS,
  FEEDBACK_CATEGORY_LABELS,
  FOUNDER_SEATS_PER_CAREER,
  betaMetricRows,
  betaMetricsCsv,
  founderSeatRows,
  isFeedbackCategory,
  isRoleKey,
  type BetaMetricRow,
} from "@job-search-os/pipeline";
import { notFound } from "next/navigation";
import { careerLabel } from "@/lib/career-market";
import { getBetaFeedback, type FeedbackListResult } from "@/lib/beta-feedback";
import {
  getBetaMetrics,
  getCareerReveal,
  getFounderCounts,
  type CareerRevealResult,
  type CareerVisibilityRow,
  type FounderCountsResult,
} from "@/lib/beta-metrics";
import { requireUserId } from "@/lib/session";

export const metadata = { title: "Métricas de la beta" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Métricas de la beta (C-14), solo admins: agregados de los últimos 7 y 30 días para seguir el
 * piloto. Sin ningún dato individual; lo que sale de menos de k personas aparece como «<k». El CSV
 * sale de los mismos agregados, armado en el servidor. Para mostrar afuera (financiamiento), la
 * política de privacidad tiene que decirlo antes y conviene redondear.
 */
export default async function MetricasPage() {
  const userId = await requireUserId();
  const result = await getBetaMetrics(userId);
  // Para quien no es admin, la página no existe (igual que una ruta desconocida)
  if (!result.ok && result.reason === "no_admin") notFound();

  if (!result.ok) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">Métricas de la beta</h1>
        <p role="status" className="rounded-card border border-line bg-surface p-4 text-sm">
          {result.reason === "no_habilitado"
            ? "Tu cuenta es admin en la app pero todavía no está habilitada en la base (app_admins)."
            : "Todavía no hay métricas: falta aplicar la migración de la base o no se pudieron leer."}
        </p>
      </div>
    );
  }

  const { metrics } = result;
  const rows = betaMetricRows(metrics);
  const groups = [...new Set(rows.map((r) => r.group))];
  const founders = await getFounderCounts(userId);
  const feedback = await getBetaFeedback(userId);
  const reveal = await getCareerReveal(userId);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(betaMetricsCsv(metrics))}`;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Métricas de la beta</h1>
        <p className="text-sm text-fg-subtle">
          Al {DATE.format(new Date(metrics.generated_at))}. Solo agregados: lo que sale de menos de{" "}
          {metrics.k} personas aparece como «&lt;{metrics.k}».
        </p>
      </div>
      {groups.map((group) => (
        <MetricTable key={group} title={group} rows={rows.filter((r) => r.group === group)} />
      ))}
      <FounderSeats founders={founders} k={metrics.k} />
      <HiddenCareers reveal={reveal} />
      <BetaFeedbackList feedback={feedback} />
      <a
        href={csvHref}
        download="metricas-beta.csv"
        className="inline-flex min-h-11 items-center self-start rounded-control border border-fg px-4 text-sm font-medium text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Descargar CSV
      </a>
    </div>
  );
}

/**
 * Carreras de la beta en público (C4-3, ADR-029): las ofertas del pool de los últimos 30 días contra el
 * umbral de 10 (ADR-022). Desde ADR-029 no hay nada que mergear: la carrera aparece sola en los chips, el
 * sitemap y /mercado cuando llega al umbral (hasta unas 2 horas después, por el caché). Los números salen
 * de `role_hints`, así que valen después de `pool:rehint`.
 */
function HiddenCareers({ reveal }: { reveal: CareerRevealResult }) {
  if (!reveal.ok) {
    return (
      <p role="status" className="rounded-card border border-line bg-surface p-4 text-sm">
        Carreras ocultas: no se pudieron leer las ofertas del pool.
      </p>
    );
  }
  const shown = reveal.rows.filter((r) => r.shown).length;
  return (
    <section
      className="rounded-card border border-line bg-surface p-4"
      data-testid="carreras-beta-publico"
    >
      <table className="w-full text-sm">
        <caption className="mb-2 text-left font-medium">Carreras de la beta en público</caption>
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th scope="col" className="pb-1 font-normal">
              Carrera
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              Ofertas ({CAREER_REVEAL_WINDOW_DAYS} días)
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              Estado
            </th>
          </tr>
        </thead>
        <tbody>
          {reveal.rows.map((r) => (
            <HiddenCareerRow key={r.role} row={r} />
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-fg-subtle">
        Ofertas nuevas del pool (sin copias) contra el umbral de {CAREER_REVEAL_THRESHOLD}{" "}
        (ADR-022). Al llegar, la carrera aparece sola en el sitio público (ADR-029).
        {shown > 0
          ? ` ${shown === 1 ? "Hay 1 carrera visible" : `Hay ${shown} carreras visibles`}.`
          : " Todavía ninguna llega."}
      </p>
    </section>
  );
}

function HiddenCareerRow({ row }: { row: CareerVisibilityRow }) {
  const label = isRoleKey(row.role) ? careerLabel(row.role) : row.role;
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
        {label}
      </th>
      <td className="py-1 text-right font-medium tabular-nums">
        {row.received}
        <span className="font-normal text-fg-subtle"> de {row.threshold}</span>
      </td>
      <td className="py-1 text-right">
        {row.shown ? (
          <span className="rounded-badge border border-success-line bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
            Visible en público
          </span>
        ) : row.forcedHidden ? (
          <span className="text-xs text-fg-subtle">Oculta a mano</span>
        ) : (
          <span className="text-xs text-fg-subtle">
            {row.missing === 1 ? "Falta 1" : `Faltan ${row.missing}`}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Cupos de fundador por carrera (C-13b): cuántas personas tienen el plan fundador vigente en cada
 * carrera. Sin cupo decidido (a confirmar con Ani) no hay «de N»; no se bloquea nada.
 */
function FounderSeats({ founders, k }: { founders: FounderCountsResult; k: number }) {
  if (!founders.ok) {
    return (
      <p role="status" className="rounded-card border border-line bg-surface p-4 text-sm">
        Cupos de fundador: todavía no hay datos (falta aplicar la migración de la base o no se
        pudieron leer).
      </p>
    );
  }
  const rows = founderSeatRows(founders.rows, FOUNDER_SEATS_PER_CAREER, (key) =>
    isRoleKey(key) ? careerLabel(key) : null,
  );
  const pending = FOUNDER_SEATS_PER_CAREER === null ? " El cupo todavía no está definido." : "";
  const note = `Personas con plan fundador vigente, por su carrera principal. Menos de ${k}: «<${k}».`;
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left font-medium">Cupos de fundador</caption>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-1 text-fg-muted">Todavía no hay personas con plan fundador.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="border-t border-line">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                  {r.label}
                </th>
                <td className="py-1 text-right font-medium tabular-nums">{r.value}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-fg-subtle">{note + pending}</p>
    </section>
  );
}

/**
 * «Lo que nos contaron» (C-23): las últimas 50 de «Contanos qué pasó». Sin email ni nombre: solo un
 * identificador seudónimo corto. El mensaje es texto de una persona: se renderiza como texto (React
 * lo escapa), con los saltos de línea conservados por CSS, nunca como HTML.
 */
function BetaFeedbackList({ feedback }: { feedback: FeedbackListResult }) {
  if (!feedback.ok) {
    return (
      <p role="status" className="rounded-card border border-line bg-surface p-4 text-sm">
        Lo que nos contaron: todavía no hay datos (falta aplicar la migración de la base o no se
        pudieron leer).
      </p>
    );
  }
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="mb-2 font-medium">Lo que nos contaron</h2>
      {feedback.rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Todavía no hay comentarios.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feedback.rows.map((r, i) => (
            <li key={i} className="border-t border-line pt-2 text-sm">
              <p className="text-xs text-fg-subtle">
                {DATE.format(r.createdAt)} ·{" "}
                {isFeedbackCategory(r.category) ? FEEDBACK_CATEGORY_LABELS[r.category] : r.category}{" "}
                · <code>{r.path}</code> · persona {r.person}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MetricTable({ title, rows }: { title: string; rows: BetaMetricRow[] }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left font-medium">{title}</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.metric} className="border-t border-line">
              <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">
                {r.metric}
              </th>
              <td className="py-1 text-right font-medium tabular-nums">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
