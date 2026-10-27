import Link from "next/link";
import { EmptyState, textLinkClasses } from "@/components/ui";
import {
  APPLICATION_OUTCOMES,
  type FeedbackReport,
  type FeedbackRow,
} from "@job-search-os/pipeline";
import { getFeedbackReport, listApplications, listFollowUps } from "@/lib/applications";
import { ACTION_LABELS, OUTCOME_LABELS, STATUS_LABELS } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { setOutcomeAction } from "./actions";
import { closeApplicationAction, snoozeFollowUpAction } from "./followup-actions";

const FOLLOW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus";

export const dynamic = "force-dynamic";
export const metadata = { title: "Postulaciones" };

/** Con menos postulaciones que esto, la calibración no dice nada: va plegada y debajo de la lista. */
const CALIBRATION_MIN_APPS = 5;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
/** "Te sirve": 👍 y 👎 de un toque sobre la evaluación; "–" si todavía no hay ninguno. */
const verdictText = (up: number, down: number) => (up + down === 0 ? "–" : `${up} 👍 · ${down} 👎`);
const OUTCOME_CLASSES: Record<string, string> = {
  entrevista: "bg-success-muted text-success",
  oferta: "bg-success-line text-success",
  rechazo_humano: "bg-danger-muted text-danger",
  rechazo_automatico_ubicacion: "bg-danger-soft text-danger",
  rechazo_automatico_otro: "bg-danger-soft text-danger",
  sin_respuesta: "bg-surface-muted text-fg-muted",
  cerrada_antes: "bg-surface-muted text-fg-subtle",
  retirada: "bg-surface-muted text-fg-subtle",
};

/**
 * Postulaciones y feedback loop (JS-036). Server Component: lista de postulaciones con su resultado
 * (editable) y el reporte de calibración con ofertas reales: respuesta por banda de score, la
 * métrica del PRD (score ≥ 7) y las sorpresas que deberían mover el evaluador o el prefiltro.
 * Con menos de 5 postulaciones la calibración va plegada debajo de la lista (ronda C5, A-5).
 */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  const { error } = await searchParams;
  const [apps, report, followUps] = await Promise.all([
    listApplications(userId),
    getFeedbackReport(userId),
    listFollowUps(userId, new Date()),
  ]);
  const titleOf = new Map(apps.map((a) => [a.jobId, `${a.company} · ${a.title}`]));
  const fewApps = apps.length < CALIBRATION_MIN_APPS;
  const calibration = <Calibration report={report} titleOf={titleOf} />;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-title font-semibold">Postulaciones</h1>
        <p className="text-xs text-fg-subtle">
          {report.applied} postulaciones sobre {report.evaluated} evaluadas
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          Resultado inválido.
        </p>
      ) : null}

      {followUps.length ? (
        <section
          aria-labelledby="seguimiento"
          className="flex flex-col gap-2 rounded-card border border-warning-line bg-warning-soft p-3"
        >
          <h2 id="seguimiento" className="text-sm font-semibold text-fg">
            Para hacer seguimiento ({followUps.length})
          </h2>
          <p className="text-xs text-fg-muted">
            Hace rato que no hay novedades de estas postulaciones. Fijate si te escribieron o
            escribiles vos. «Ya hice seguimiento» te la vuelve a mostrar en una semana.
          </p>
          <ul className="flex flex-col gap-2">
            {followUps.map((f) => (
              <li
                key={f.jobId}
                data-testid="seguimiento-item"
                className="rounded-control border border-warning-line bg-surface p-3"
              >
                <Link href={`/jobs/${f.jobId}`} className="text-sm font-medium text-fg">
                  {f.title}
                </Link>
                <p className="text-xs text-fg-subtle">
                  {f.company} · {STATUS_LABELS[f.status] ?? f.status} · hace {f.daysSince}{" "}
                  {f.daysSince === 1 ? "día" : "días"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={snoozeFollowUpAction.bind(null, f.jobId)}>
                    <button type="submit" className={FOLLOW_BUTTON}>
                      Ya hice seguimiento
                    </button>
                  </form>
                  <Link href={`/jobs/${f.jobId}`} className={FOLLOW_BUTTON}>
                    Me respondieron
                  </Link>
                  {/* Cerrar pide confirmación: está al lado de la acción más usada y no se deshace acá */}
                  <details className="ml-auto">
                    <summary className="flex min-h-11 cursor-pointer items-center px-2 text-sm text-fg-subtle underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
                      Cerrar postulación
                    </summary>
                    <form
                      action={closeApplicationAction.bind(null, f.jobId)}
                      className="mt-1 flex items-center gap-2"
                    >
                      <span className="text-xs text-fg-muted">¿Ya no la seguís?</span>
                      <button type="submit" className={FOLLOW_BUTTON}>
                        Sí, cerrar
                      </button>
                    </form>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fewApps ? null : calibration}

      {apps.length === 0 ? (
        <EmptyState
          action={
            <Link href="/jobs" className={textLinkClasses({ block: true })}>
              Ver mis ofertas
            </Link>
          }
        >
          Sin postulaciones. Se crean al marcar &quot;Aplicar&quot; en el detalle de una oferta.
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-2">
          {apps.map((a) => (
            <li key={a.id} className="rounded-card border border-line bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/jobs/${a.jobId}`} className="text-sm font-medium text-fg">
                    {a.title}
                  </Link>
                  <p className="text-xs text-fg-subtle">
                    {a.company} · {STATUS_LABELS[a.status] ?? a.status}
                    {a.appliedAt ? ` · postulada ${a.appliedAt}` : ""}
                    {a.channel ? ` · ${a.channel}` : ""}
                    {a.score !== null
                      ? ` · score ${a.score}${a.accion ? ` (${ACTION_LABELS[a.accion] ?? a.accion})` : ""}`
                      : " · sin evaluación"}
                    {a.model === "fake" ? " · modo demo" : ""}
                  </p>
                  {a.outcomeNote ? <p className="text-xs text-fg-subtle">{a.outcomeNote}</p> : null}
                </div>
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs ${OUTCOME_CLASSES[a.outcome] ?? ""}`}
                >
                  {OUTCOME_LABELS[a.outcome] ?? a.outcome}
                  {a.outcomeAt ? ` · ${a.outcomeAt}` : ""}
                </span>
              </div>
              <form
                // Con lo guardado en la key, el form se remonta y sus defaultValue siguen a la base
                key={`${a.outcome}|${a.outcomeNote ?? ""}`}
                action={setOutcomeAction}
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="applicationId" value={a.id} />
                <select
                  name="outcome"
                  defaultValue={a.outcome}
                  className="rounded-control border border-line-strong px-2 py-1 text-xs"
                  aria-label="Resultado"
                >
                  {APPLICATION_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {OUTCOME_LABELS[o] ?? o}
                    </option>
                  ))}
                </select>
                <input
                  name="note"
                  defaultValue={a.outcomeNote ?? ""}
                  placeholder="Nota (opcional)"
                  className="min-w-0 flex-1 rounded-control border border-line-strong px-2 py-1 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-control bg-brand px-2 py-1 text-xs text-brand-contrast"
                >
                  Guardar resultado
                </button>
              </form>
            </li>
          ))}
        </ol>
      )}

      {fewApps ? (
        <details
          data-testid="calibracion-plegada"
          className="rounded-card border border-line bg-surface p-3"
        >
          <summary className="cursor-pointer text-sm font-semibold text-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
            Cómo viene la calibración
          </summary>
          <div className="mt-2">{calibration}</div>
        </details>
      ) : null}

      <p className="text-xs text-fg-subtle">
        El estado de la oferta (rechazada, entrevista, oferta) se cambia desde su detalle y
        actualiza el resultado acá; el resultado también se puede corregir a mano.
      </p>
    </section>
  );
}

function Calibration({
  report,
  titleOf,
}: {
  report: FeedbackReport;
  titleOf: Map<string, string>;
}) {
  const surprise = (label: string, rows: FeedbackRow[]) =>
    rows.length ? (
      <li>
        <span className="font-medium">{label}:</span>{" "}
        {rows.map((r, i) => (
          <span key={r.jobId}>
            {i ? ", " : ""}
            <Link href={`/jobs/${r.jobId}`} className="underline">
              {titleOf.get(r.jobId) ?? r.jobId.slice(0, 8)}
            </Link>{" "}
            ({r.score ?? "?"})
          </span>
        ))}
      </li>
    ) : null;

  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
      <h2 className="text-sm font-semibold text-fg-muted">Calibración con ofertas reales</h2>
      <p className="text-sm">
        Respuesta positiva (entrevista u oferta) con score ≥ 7:{" "}
        <strong>{pct(report.highScore.rate)}</strong>{" "}
        <span className="text-xs text-fg-subtle">
          ({report.highScore.positive} de {report.highScore.applied} postulaciones)
        </span>
      </p>
      {/* Con teclado se puede desplazar a 360 px (axe: scrollable-region-focusable, C-4) */}
      <div
        role="region"
        aria-label="Calibración por score"
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <table className="w-full text-xs">
          <thead className="text-left text-fg-subtle">
            <tr>
              <th className="py-1 pr-3">Score</th>
              <th className="py-1 pr-3">Evaluadas</th>
              <th className="py-1 pr-3">Postuladas</th>
              <th className="py-1 pr-3">Entrevista/oferta</th>
              <th className="py-1 pr-3">Rechazo humano</th>
              <th className="py-1 pr-3">Rechazo automático</th>
              <th className="py-1 pr-3">Sin respuesta</th>
              <th className="py-1 pr-3">Tasa positiva</th>
              <th className="py-1">Te sirve</th>
            </tr>
          </thead>
          <tbody>
            {report.bands.map((b) => (
              <tr key={b.band} className="border-t border-line">
                <td className="py-1 pr-3 font-medium">{b.band}</td>
                <td className="py-1 pr-3">{b.evaluated}</td>
                <td className="py-1 pr-3">{b.applied}</td>
                <td className="py-1 pr-3">{b.positive}</td>
                <td className="py-1 pr-3">{b.rejectedHuman}</td>
                <td className="py-1 pr-3">{b.rejectedAuto}</td>
                <td className="py-1 pr-3">{b.noAnswer}</td>
                <td className="py-1 pr-3">{pct(b.positiveRate)}</td>
                <td className="py-1">{verdictText(b.verdicts.agree, b.verdicts.disagree)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-medium">
              <td className="py-1 pr-3" colSpan={8}>
                Total
              </td>
              <td className="py-1">
                {verdictText(report.verdicts.agree, report.verdicts.disagree)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {report.humanVsModel ? (
        <p className="text-xs text-fg-subtle">
          Modelo vs tu score en la UI: MAE {report.humanVsModel.mae.toFixed(2)} sobre{" "}
          {report.humanVsModel.n} evaluaciones, sesgo {report.humanVsModel.bias >= 0 ? "+" : ""}
          {report.humanVsModel.bias.toFixed(2)} (positivo = el modelo puntúa de más).
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          Cargá tu score en el detalle de las ofertas evaluadas para comparar modelo vs humano fuera
          del golden.
        </p>
      )}
      {report.surprises.lowScorePositive.length ||
      report.surprises.autoLocationRejectWithOk.length ||
      report.surprises.highScoreNoAnswer.length ? (
        <ul className="flex flex-col gap-1 text-xs text-fg-muted">
          {surprise(
            "Score bajo con respuesta positiva (el evaluador subestimó)",
            report.surprises.lowScorePositive,
          )}
          {surprise(
            "Rechazo automático por ubicación en una oferta que parecía compatible (revisar el aviso o la regla)",
            report.surprises.autoLocationRejectWithOk,
          )}
          {surprise("Score ≥ 7 sin respuesta", report.surprises.highScoreNoAnswer)}
        </ul>
      ) : null}
    </section>
  );
}
