import Link from "next/link";
import { Illustration } from "@/components/brand/illustration";
import { ApplicationRow } from "@/components/applications/application-row";
import { CollapsibleGroup } from "@/components/applications/collapsible-group";
import { ConfirmAction } from "@/components/applications/confirm-action";
import { FollowUpRow } from "@/components/applications/follow-up-row";
import { Alert, buttonClasses, cardClasses, EmptyState, textLinkClasses } from "@/components/ui";
import {
  groupApplication,
  type ApplicationGroup,
  type FeedbackReport,
  type FeedbackRow,
} from "@job-search-os/pipeline";
import {
  getFeedbackReport,
  listApplications,
  listFollowUps,
  listStaleEvaluated,
  type ApplicationView,
} from "@/lib/applications";
import { requireUserId } from "@/lib/session";
import { changeStatusAction, correctStatusAction } from "../jobs/[id]/actions";
import { closeApplicationAction, snoozeFollowUpAction } from "./followup-actions";

const SMALL_BUTTON = buttonClasses({ variant: "secondary", size: "sm" });
// Panel blanco de la pantalla (C9-11): radio 24, sin borde lateral
const PANEL = cardClasses({ padding: "none", className: "p-4 sm:p-5" });

export const dynamic = "force-dynamic";
export const metadata = { title: "Postulaciones" };

/** Con menos postulaciones que esto, la calibración no dice nada. Va siempre plegada; con pocas, se marca con un testid. */
const CALIBRATION_MIN_APPS = 5;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);
/** "Te sirve": 👍 y 👎 de un toque sobre la evaluación; "–" si todavía no hay ninguno. */
const verdictText = (up: number, down: number) => (up + down === 0 ? "–" : `${up} 👍 · ${down} 👎`);

/**
 * Postulaciones y feedback loop (JS-036, rediseño R4-07). Server Component. Cada postulación aparece
 * en un solo grupo (`groupApplication`, pipeline puro): seguimiento, activas, esperando respuesta,
 * y plegadas las inactivas, las cerradas, las ofertas descartadas por inactividad y la calibración.
 */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const userId = await requireUserId();
  const { error } = await searchParams;
  const today = new Date();
  const [apps, report, followUps, stale] = await Promise.all([
    listApplications(userId),
    getFeedbackReport(userId),
    listFollowUps(userId, today),
    listStaleEvaluated(userId, today),
  ]);
  const titleOf = new Map(apps.map((a) => [a.jobId, `${a.company} · ${a.title}`]));
  const fewApps = apps.length < CALIBRATION_MIN_APPS;

  const dueIds = new Set(followUps.map((f) => f.jobId));
  const groups: Record<ApplicationGroup, ApplicationView[]> = {
    seguimiento: [],
    activas: [],
    esperando: [],
    inactivas: [],
    cerradas: [],
  };
  for (const a of apps) {
    const group = groupApplication(
      {
        status: a.status,
        outcome: a.outcome,
        ...a.dates,
        followUpDue: dueIds.has(a.jobId),
      },
      today,
    );
    groups[group].push(a);
  }
  const followIds = new Set(groups.seguimiento.map((a) => a.jobId));
  const followRows = followUps.filter((f) => followIds.has(f.jobId));
  const nothingPending = followRows.length + groups.activas.length + groups.esperando.length === 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-title font-bold">Postulaciones</h1>
        <p className="text-xs text-fg-subtle">
          {report.applied} postulaciones sobre {report.evaluated} evaluadas
        </p>
      </div>
      {error ? (
        <Alert tone="danger" role="alert">
          Resultado inválido.
        </Alert>
      ) : null}

      {followRows.length ? (
        <section
          aria-labelledby="seguimiento"
          className={cardClasses({
            tone: "warning",
            padding: "md",
            className: "flex flex-col gap-3",
          })}
        >
          <h2 id="seguimiento" className="text-base font-bold text-fg">
            Para hacer seguimiento ({followRows.length})
          </h2>
          <p className="text-sm text-fg-muted">
            Hace rato que no hay novedades de estas postulaciones. Fijate si te escribieron o
            escribiles vos. «Ya hice seguimiento» te la vuelve a mostrar en una semana.
          </p>
          <ul className={`${PANEL} divide-y divide-line`}>
            {followRows.map((f) => (
              <FollowUpRow key={f.jobId} f={f} />
            ))}
          </ul>
        </section>
      ) : null}

      {apps.length === 0 ? (
        <EmptyState
          illustration={<Illustration escena="postulaciones" className="w-40 sm:w-52" />}
          action={
            <Link href="/jobs" className={textLinkClasses({ block: true })}>
              Ver mis ofertas
            </Link>
          }
        >
          Sin postulaciones. Se crean al marcar &quot;Aplicar&quot; en el detalle de una oferta.
        </EmptyState>
      ) : null}

      {apps.length > 0 && nothingPending ? (
        <p className="text-sm text-fg-muted">
          Nada pendiente hoy.
          {groups.inactivas.length
            ? ` Sin respuesta por inactividad: ${groups.inactivas.length}.`
            : ""}
          {groups.cerradas.length ? ` Cerradas: ${groups.cerradas.length}.` : ""}
        </p>
      ) : null}

      {groups.activas.length ? (
        <section aria-labelledby="grupo-activas" className={PANEL}>
          <h2 id="grupo-activas" className="mb-2 text-base font-bold text-fg">
            Activas ({groups.activas.length})
          </h2>
          <ul className="divide-y divide-line">
            {groups.activas.map((a) => (
              <ApplicationRow key={a.id} a={a} form="visible" />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.esperando.length ? (
        <section aria-labelledby="grupo-esperando" className={PANEL}>
          <h2 id="grupo-esperando" className="mb-2 text-base font-bold text-fg">
            Esperando respuesta ({groups.esperando.length})
          </h2>
          <ul className="divide-y divide-line">
            {groups.esperando.map((a) => (
              <ApplicationRow key={a.id} a={a} form="visible" />
            ))}
          </ul>
        </section>
      ) : null}

      {groups.inactivas.length ? (
        <CollapsibleGroup
          title="Sin respuesta (cerrada por inactividad)"
          count={groups.inactivas.length}
          testId="grupo-inactivas"
        >
          <ul className="divide-y divide-line">
            {groups.inactivas.map((a) => (
              <ApplicationRow
                key={a.id}
                a={a}
                form="details"
                actions={
                  <>
                    <form action={snoozeFollowUpAction.bind(null, a.jobId)}>
                      <button type="submit" className={SMALL_BUTTON}>
                        Reactivar
                      </button>
                    </form>
                    <ConfirmAction
                      summary="Cerrar por inactividad"
                      question="¿La damos por cerrada?"
                      confirmLabel="Sí, cerrar"
                      action={closeApplicationAction.bind(null, a.jobId)}
                    />
                  </>
                }
              />
            ))}
          </ul>
        </CollapsibleGroup>
      ) : null}

      {groups.cerradas.length ? (
        <CollapsibleGroup title="Cerradas" count={groups.cerradas.length} testId="grupo-cerradas">
          <ul className="divide-y divide-line">
            {groups.cerradas.map((a) => (
              <ApplicationRow
                key={a.id}
                a={a}
                form="details"
                actions={
                  // Sin evaluación la corrección de estado falla: ahí no se ofrece
                  a.status === "cerrada" && a.score !== null ? (
                    <form action={correctStatusAction}>
                      <input type="hidden" name="jobId" value={a.jobId} />
                      <input type="hidden" name="to" value="aplicada" />
                      <button type="submit" className={SMALL_BUTTON}>
                        Reactivar
                      </button>
                    </form>
                  ) : null
                }
              />
            ))}
          </ul>
        </CollapsibleGroup>
      ) : null}

      {stale.length ? (
        <CollapsibleGroup
          title="Ofertas descartadas por inactividad"
          count={stale.length}
          testId="grupo-descartadas"
        >
          <ul className="divide-y divide-line">
            {stale.map((j) => (
              <li
                key={j.jobId}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link href={`/jobs/${j.jobId}`} className="font-bold text-fg hover:underline">
                    {j.title}
                  </Link>
                  <p className="text-xs text-fg-subtle">
                    {j.company} · Evaluada · sin tocar desde{" "}
                    {j.touchedAt.toISOString().slice(0, 10)}
                  </p>
                </div>
                <ConfirmAction
                  summary="Descartar"
                  question="¿Ya no te interesa?"
                  confirmLabel="Sí, descartar"
                  action={changeStatusAction}
                >
                  <input type="hidden" name="jobId" value={j.jobId} />
                  <input type="hidden" name="event" value="discard" />
                </ConfirmAction>
              </li>
            ))}
          </ul>
        </CollapsibleGroup>
      ) : null}

      <CollapsibleGroup
        title="Cómo viene la calibración"
        testId={fewApps ? "calibracion-plegada" : "calibracion"}
      >
        <Calibration report={report} titleOf={titleOf} />
      </CollapsibleGroup>

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
    <div className="flex flex-col gap-3">
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
    </div>
  );
}
