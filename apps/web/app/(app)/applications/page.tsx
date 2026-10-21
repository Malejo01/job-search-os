import Link from "next/link";
import { APPLICATION_OUTCOMES, type FeedbackRow } from "@job-search-os/pipeline";
import { getFeedbackReport, listApplications, listFollowUps } from "@/lib/applications";
import { ACTION_LABELS, OUTCOME_LABELS, STATUS_LABELS } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { setOutcomeAction } from "./actions";
import { closeApplicationAction, snoozeFollowUpAction } from "./followup-actions";

const FOLLOW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";

export const dynamic = "force-dynamic";
export const metadata = { title: "Postulaciones" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
/** "Te sirve": 👍 y 👎 de un toque sobre la evaluación; "–" si todavía no hay ninguno. */
const verdictText = (up: number, down: number) => (up + down === 0 ? "–" : `${up} 👍 · ${down} 👎`);
const OUTCOME_CLASSES: Record<string, string> = {
  entrevista: "bg-emerald-100 text-emerald-900",
  oferta: "bg-emerald-200 text-emerald-950",
  rechazo_humano: "bg-red-100 text-red-900",
  rechazo_automatico_ubicacion: "bg-red-50 text-red-800",
  rechazo_automatico_otro: "bg-red-50 text-red-800",
  sin_respuesta: "bg-zinc-100 text-zinc-700",
  cerrada_antes: "bg-zinc-100 text-zinc-600",
  retirada: "bg-zinc-100 text-zinc-600",
};

/**
 * Postulaciones y feedback loop (JS-036). Server Component: lista de postulaciones con su resultado
 * (editable) y el reporte de calibración con ofertas reales: respuesta por banda de score, la
 * métrica del PRD (score ≥ 7) y las sorpresas que deberían mover el evaluador o el prefiltro.
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
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Postulaciones</h1>
        <p className="text-xs text-zinc-600">
          {report.applied} postulaciones sobre {report.evaluated} evaluadas
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Resultado inválido.
        </p>
      ) : null}

      {followUps.length ? (
        <section
          aria-labelledby="seguimiento"
          className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
        >
          <h2 id="seguimiento" className="text-sm font-semibold text-zinc-800">
            Para hacer seguimiento ({followUps.length})
          </h2>
          <p className="text-xs text-zinc-700">
            Hace rato que no hay novedades de estas postulaciones. Fijate si te escribieron o
            escribiles vos. «Ya hice seguimiento» te la vuelve a mostrar en una semana.
          </p>
          <ul className="flex flex-col gap-2">
            {followUps.map((f) => (
              <li
                key={f.jobId}
                data-testid="seguimiento-item"
                className="rounded-md border border-amber-200 bg-white p-3"
              >
                <Link href={`/jobs/${f.jobId}`} className="text-sm font-medium text-zinc-900">
                  {f.title}
                </Link>
                <p className="text-xs text-zinc-600">
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
                    <summary className="flex min-h-11 cursor-pointer items-center px-2 text-sm text-zinc-600 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900">
                      Cerrar postulación
                    </summary>
                    <form
                      action={closeApplicationAction.bind(null, f.jobId)}
                      className="mt-1 flex items-center gap-2"
                    >
                      <span className="text-xs text-zinc-700">¿Ya no la seguís?</span>
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

      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-zinc-700">Calibración con ofertas reales</h2>
        <p className="text-sm">
          Respuesta positiva (entrevista u oferta) con score ≥ 7:{" "}
          <strong>{pct(report.highScore.rate)}</strong>{" "}
          <span className="text-xs text-zinc-600">
            ({report.highScore.positive} de {report.highScore.applied} postulaciones)
          </span>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-zinc-600">
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
                <tr key={b.band} className="border-t border-zinc-100">
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
              <tr className="border-t border-zinc-200 font-medium">
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
          <p className="text-xs text-zinc-600">
            Modelo vs tu score en la UI: MAE {report.humanVsModel.mae.toFixed(2)} sobre{" "}
            {report.humanVsModel.n} evaluaciones, sesgo {report.humanVsModel.bias >= 0 ? "+" : ""}
            {report.humanVsModel.bias.toFixed(2)} (positivo = el modelo puntúa de más).
          </p>
        ) : (
          <p className="text-xs text-zinc-600">
            Cargá tu score en el detalle de las ofertas evaluadas para comparar modelo vs humano
            fuera del golden.
          </p>
        )}
        {report.surprises.lowScorePositive.length ||
        report.surprises.autoLocationRejectWithOk.length ||
        report.surprises.highScoreNoAnswer.length ? (
          <ul className="flex flex-col gap-1 text-xs text-zinc-700">
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

      {apps.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          Sin postulaciones. Se crean al marcar &quot;Aplicar&quot; en el detalle de una oferta.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {apps.map((a) => (
            <li key={a.id} className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/jobs/${a.jobId}`} className="text-sm font-medium text-zinc-900">
                    {a.title}
                  </Link>
                  <p className="text-xs text-zinc-600">
                    {a.company} · {STATUS_LABELS[a.status] ?? a.status}
                    {a.appliedAt ? ` · postulada ${a.appliedAt}` : ""}
                    {a.channel ? ` · ${a.channel}` : ""}
                    {a.score !== null
                      ? ` · score ${a.score}${a.accion ? ` (${ACTION_LABELS[a.accion] ?? a.accion})` : ""}`
                      : " · sin evaluación"}
                    {a.model === "fake" ? " · modo demo" : ""}
                  </p>
                  {a.outcomeNote ? <p className="text-xs text-zinc-600">{a.outcomeNote}</p> : null}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${OUTCOME_CLASSES[a.outcome] ?? ""}`}
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
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
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
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-white"
                >
                  Guardar resultado
                </button>
              </form>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-zinc-600">
        El estado de la oferta (rechazada, entrevista, oferta) se cambia desde su detalle y
        actualiza el resultado acá; el resultado también se puede corregir a mano.
      </p>
    </section>
  );
}
