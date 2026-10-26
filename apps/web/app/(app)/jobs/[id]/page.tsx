import {
  englishIsNotAGap,
  fitCrossSentence,
  isEnglishGap,
  isEnglishSkillSlug,
  withCurrentSkillLevels,
  type JobEvent,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequisitosDelAviso } from "@/components/requisitos-del-aviso";
import { notEvaluatedMessage } from "@/lib/evaluate-now";
import { getMainFitSummary } from "@/lib/fit";
import { isUuid } from "@/lib/ids";
import { getJobDetail } from "@/lib/job-detail";
import { jobNeighbors, listQuery, parseJobFilters } from "@/lib/jobs";
import {
  ACTION_ADVICE,
  ACTION_LABELS,
  adjustmentText,
  COMPANY_TYPE_LABEL,
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  BLOCKER_LABEL,
  DISCIPLINE_LABEL,
  ENGLISH_LABEL,
  flagLabel,
  formatDate,
  formatScore,
  formatScoreNumber,
  LOCATION_CLASSES,
  LOCATION_LABELS,
  MODALITY_LABELS,
  OUTCOME_LABELS,
  riskLabel,
  safeHttpUrl,
  SCORE_CLASSES,
  scoreTone,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { changeStatusAction, dismissDuplicateAction, humanScoreAction } from "./actions";
import { AutoRefresh } from "../auto-refresh";
import { ApplyButton } from "./apply-button";
import { getSavedFormAnswers } from "./form-data";
import { FormReview } from "./form-review";
import { MergeButton } from "./merge-button";
import { EvaluateNow } from "./evaluate-now";
import { ReviewNav } from "./review-nav";
import { SourceAttribution } from "./source-attribution";
import { StatusCorrection } from "./status-correction";
import { SkillLevelButton } from "./skill-level-modal";
import { Verdict } from "./verdict";

export const dynamic = "force-dynamic";

export const metadata = { title: "Oferta" };

const EVENT_LABELS: Record<JobEvent, string> = {
  prefilter_pass: "Pasó los filtros",
  prefilter_discard: "Descartar automáticamente",
  needs_jd: "Falta la descripción",
  evaluated: "Evaluada",
  apply: "Marcar aplicada",
  discard: "Descartar",
  auto_reject: "Rechazo automático",
  reject: "Rechazada",
  interview: "Entrevista",
  offer: "Oferta",
  close: "Cerrar",
};

const ERRORS: Record<string, string> = {
  evento: "Evento desconocido.",
  transicion: "Esa transición no vale desde el estado actual (la página estaba desactualizada).",
  score: "El score humano va de 0 a 10 en pasos de 0,5.",
  correccion: "Esa corrección no vale desde el estado actual (la página estaba desactualizada).",
  fusion:
    "No se pudo fusionar: las ofertas cambiaron (una ya tiene evaluación o postulación, o se está evaluando). Recargá y revisá.",
  evaluar: "No se puede evaluar esta oferta: no tiene la descripción del puesto.",
  veredicto: "No se pudo guardar tu respuesta: la evaluación ya no existe. Recargá la página.",
  motivo:
    "No se pudo guardar el motivo: admite hasta 140 caracteres y la evaluación tiene que existir.",
};

/** Detalle de una oferta (JS-016): evaluación completa, fuentes, acciones de estado y score humano. */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  // Tope de gasto o chequeo fallido (JS-105): la oferta quedó guardada, pero no se evaluó ahora
  const capNotice =
    sp.cap === "user" || sp.cap === "global" || sp.cap === "pendiente" || sp.cap === "onboarding"
      ? `Oferta guardada. ${notEvaluatedMessage(sp.cap)}`
      : null;
  // Los filtros de la lista viajan en la URL del detalle (JS-061): "volver" y "siguiente" los
  // respetan, y el orden sale de la misma consulta que la lista.
  const filters = parseJobFilters(sp);
  const query = listQuery(filters);
  const [job, around, savedForm] = await Promise.all([
    getJobDetail(userId, id),
    jobNeighbors(userId, id, filters),
    getSavedFormAnswers(userId, id),
  ]);
  if (!job) notFound();
  const flagTexts = job.flags.flatMap((f) => flagLabel(f) ?? []);
  const jobUrl = safeHttpUrl(job.url);
  const ev = job.evaluation;
  // Solo con JD, sin evaluación y sin cola (el componente decide si se muestra)
  const evaluateNow = (
    <EvaluateNow
      jobId={job.id}
      hasJd={Boolean(job.jdText?.trim()) && job.status !== "descartada_prefiltro"}
      evaluated={Boolean(ev)}
      evaluating={job.evaluating}
    />
  );
  // C-6 E4b: si el descarte de esta oferta es el freno más común de la persona, se cruza con «Tu
  // encaje». Solo se calcula cuando la oferta tiene descarte: el resto de los detalles no lo paga
  const descarteId = ev?.checklist?.descarte_rapido?.id ?? null;
  const fitSummary = descarteId ? await getMainFitSummary(userId, new Date()) : null;
  const crossLine = fitSummary ? fitCrossSentence(fitSummary, descarteId) : null;
  const currentLevels = new Map(
    Object.entries(job.skillInfo).flatMap(([slug, info]) =>
      info.level === null ? [] : [[slug, info.level] as const],
    ),
  );
  const tone = scoreTone(ev?.score ?? null);
  const salary =
    job.salaryMinUsd || job.salaryMaxUsd
      ? `USD ${[job.salaryMinUsd, job.salaryMaxUsd].filter(Boolean).join("–")}${job.salaryPeriod ? ` ${job.salaryPeriod}` : ""}`
      : null;

  return (
    <article className="flex flex-col gap-4">
      <ReviewNav
        backHref={`/jobs${query}`}
        prevHref={around.prev ? `/jobs/${around.prev}${query}` : null}
        nextHref={around.next ? `/jobs/${around.next}${query}` : null}
      />
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {ERRORS[error] ?? "Algo falló."}
        </p>
      ) : null}
      {capNotice ? (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {capNotice}
        </p>
      ) : null}
      {job.evaluating && !capNotice ? (
        <p role="status" className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          En cola para evaluar. Puede tardar de unos segundos a unas horas; esta página se actualiza
          sola un rato.
        </p>
      ) : null}
      <AutoRefresh active={job.evaluating} />

      <header className="flex gap-3">
        <div
          className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md ring-1 ${SCORE_CLASSES[tone]}`}
        >
          <span className="text-2xl font-semibold leading-none">
            {ev ? formatScoreNumber(ev.score) : "–"}
          </span>
          <span className="text-[10px]">{ev ? "/10" : "score"}</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">{job.title}</h1>
          <p className="text-sm text-zinc-700">{job.company}</p>
          <p className="text-xs text-zinc-600">
            {[
              job.locationRaw,
              job.modality && job.modality !== "desconocida"
                ? (MODALITY_LABELS[job.modality] ?? job.modality)
                : null,
              job.contractType,
              salary,
              job.candidatesCount !== null ? `${job.candidatesCount} candidatos` : null,
              formatDate(job.postedAt ?? job.firstSeenAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {ev?.model === DEMO_MODEL ? (
              <span className={DEMO_BADGE_CLASSES} title="Evaluación falsa del modo demo, sin LLM">
                DEMO · evaluación falsa
              </span>
            ) : null}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
              {STATUS_LABELS[job.status] ?? job.status}
            </span>
            {ev ? (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">
                {ACTION_ADVICE[ev.accion] ?? ACTION_LABELS[ev.accion] ?? ev.accion}
              </span>
            ) : null}
            {ev ? (
              <span className={`rounded px-1.5 py-0.5 ${LOCATION_CLASSES[ev.locationOk] ?? ""}`}>
                {LOCATION_LABELS[ev.locationOk] ?? ev.locationOk}
              </span>
            ) : null}
            {job.badges.map((b) => (
              <span key={b} className="rounded bg-zinc-50 px-1.5 py-0.5 text-zinc-600">
                {b}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Acciones de estado: Server Actions + transition(); solo los eventos válidos desde el estado actual */}
      <section aria-label="Estado" className="flex flex-wrap gap-2">
        {/* Ir a la publicación original; al volver pregunta si hubo postulación (confirmación manual) */}
        {jobUrl ? (
          <ApplyButton jobId={job.id} url={jobUrl} canApply={job.events.includes("apply")} />
        ) : null}
        {job.events.map((event) => (
          <form key={event} action={changeStatusAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="event" value={event} />
            <button
              type="submit"
              className={`rounded-md border px-3 py-2 text-sm ${
                event === "apply"
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : event === "discard" || event === "close"
                    ? "border-zinc-300 text-zinc-600"
                    : "border-zinc-400 text-zinc-800"
              }`}
            >
              {EVENT_LABELS[event]}
            </button>
          </form>
        ))}
        {job.application?.appliedAt ? (
          <p className="self-center text-xs text-zinc-600">
            aplicada el {formatDate(job.application.appliedAt)}
            {job.application.outcome
              ? ` · ${OUTCOME_LABELS[job.application.outcome] ?? job.application.outcome}`
              : ""}
          </p>
        ) : null}
      </section>
      {/* Atribución exigida por las fuentes públicas: mención + enlace al aviso original */}
      <SourceAttribution sources={job.sources} company={job.company} jdText={job.jdText} />
      {job.corrections.length ? (
        <StatusCorrection jobId={job.id} current={job.status} targets={job.corrections} />
      ) : null}

      {/* Posible duplicado (JS-025, ADR-013): parecido por empresa y título, sin nada que lo identifique */}
      {job.possibleDuplicateOf ? (
        <section
          aria-label="Posible duplicado"
          className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          <h2 className="font-semibold text-amber-900">Posible duplicado</h2>
          <p className="text-amber-900">
            Se parece a{" "}
            <Link href={`/jobs/${job.possibleDuplicateOf.id}`} className="underline">
              {job.possibleDuplicateOf.title}
            </Link>{" "}
            ({job.possibleDuplicateOf.company} ·{" "}
            {STATUS_LABELS[job.possibleDuplicateOf.status] ?? job.possibleDuplicateOf.status}):
            misma empresa y título parecido, pero sin link ni descripción en común. Si es el mismo
            aviso, fusionalas; si no, sacá la marca.
          </p>
          {job.possibleDuplicateOf.canMerge ? null : (
            <p className="text-xs text-amber-900">
              Las dos ofertas tienen evaluación o postulación: no se fusionan para no perder
              ninguna. Si son la misma, descartá una a mano.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {job.possibleDuplicateOf.canMerge ? (
              <MergeButton jobId={job.id} otherTitle={job.possibleDuplicateOf.title} />
            ) : null}
            <form action={dismissDuplicateAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <button
                type="submit"
                className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-800"
              >
                No son la misma
              </button>
            </form>
          </div>
        </section>
      ) : null}
      {job.possibleDuplicates.length ? (
        <section
          aria-label="Posibles duplicados de esta oferta"
          className="rounded-md border border-amber-200 p-3 text-sm"
        >
          <h2 className="font-semibold text-amber-900">
            {job.possibleDuplicates.length === 1
              ? "Hay 1 posible duplicado de esta oferta"
              : `Hay ${job.possibleDuplicates.length} posibles duplicados de esta oferta`}
          </h2>
          <ul className="mt-1 list-disc pl-5">
            {job.possibleDuplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/jobs/${d.id}`} className="underline">
                  {d.title}
                </Link>{" "}
                <span className="text-xs text-zinc-600">
                  {STATUS_LABELS[d.status] ?? d.status} · se revisa desde su detalle
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ev ? (
        <>
          {/* Bloqueadores y riesgos SEPARADOS: un riesgo se ve, no frena; un bloqueador frena */}
          {ev.bloqueadores.length ? (
            <section className="rounded-md border border-red-200 bg-red-50 p-3">
              <h2 className="text-sm font-semibold text-red-900">
                {BLOCKER_LABEL} ({ev.bloqueadores.length})
              </h2>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-900">
                {ev.bloqueadores.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {ev.riesgos.length ? (
            <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <h2 className="text-sm font-semibold text-amber-900">
                Riesgos ({ev.riesgos.length}) · se ven, no frenan
              </h2>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
                {ev.riesgos.map((r) => (
                  <li key={r}>{riskLabel(r)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Requisitos del aviso (ronda 104): solo si la evaluación guardó el checklist */}
          {/* C-20: el checklist guardado es una foto; se superponen los niveles de hoy (sin LLM) */}
          {ev.checklist ? (
            <RequisitosDelAviso
              checklist={withCurrentSkillLevels(ev.checklist, currentLevels)}
              modal={{ jobId: job.id, skillInfo: job.skillInfo }}
            />
          ) : null}
          {crossLine ? (
            <p data-testid="encaje-cruce" className="text-sm text-zinc-700">
              {crossLine}{" "}
              <Link
                href="/encaje"
                className="inline-flex min-h-11 items-center font-medium text-sky-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
              >
                Ver Tu encaje
              </Link>
            </p>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <Block title="Lo que ya tenés" items={ev.matchFuerte} tone="text-emerald-900" />
            <Block
              title="Lo que te falta"
              items={
                englishIsNotAGap(job.jdText, null)
                  ? ev.gaps.filter((g) => !isEnglishGap(g))
                  : ev.gaps
              }
              tone="text-zinc-800"
            />
            <Block title="Señales positivas" items={ev.senales} tone="text-zinc-800" />
            <div className="rounded-md border border-zinc-200 p-3 text-sm">
              <h2 className="font-semibold">Veredicto</h2>
              <p className="mt-1 text-zinc-800">{ev.veredicto}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-600">
                <dt>Inglés</dt>
                <dd>{ENGLISH_LABEL[ev.englishRequired] ?? ev.englishRequired}</dd>
                <dt>Años pedidos</dt>
                <dd>{ev.yearsRequired ?? "no dice"}</dd>
              </dl>
              {/* A-10 (C-5 P2-3): el detalle técnico del puntaje queda plegado, para no
                  recibir con jerga a quien no es de tecnología */}
              <details className="mt-2 text-xs text-zinc-600">
                <summary className="cursor-pointer py-1 font-medium text-zinc-700">
                  Cómo se calculó
                </summary>
                <p className="mt-1">
                  La IA lee el aviso y tu perfil y propone un puntaje. Después la app aplica reglas
                  fijas que lo suben o lo bajan.
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt>Área del aviso</dt>
                  <dd>{DISCIPLINE_LABEL[ev.discipline] ?? ev.discipline}</dd>
                  <dt>Tipo de empresa</dt>
                  <dd>
                    {ev.companyType
                      ? (COMPANY_TYPE_LABEL[ev.companyType] ?? ev.companyType)
                      : COMPANY_TYPE_LABEL.desconocido}
                  </dd>
                  <dt>Puntaje de la IA</dt>
                  <dd>{ev.scoreModel ?? ev.score}</dd>
                  <dt>Ajustes</dt>
                  <dd>
                    {ev.adjustments.length ? (
                      <ul>
                        {ev.adjustments.map((a, i) => (
                          <li key={`${i}|${a.rule}`}>{adjustmentText(a)}</li>
                        ))}
                      </ul>
                    ) : (
                      "ninguno"
                    )}
                  </dd>
                  <dt>Puntaje final</dt>
                  <dd>{ev.score}</dd>
                  <dt>Fecha de la evaluación</dt>
                  <dd>
                    {formatDate(ev.createdAt)}
                    {ev.hadFullJd ? "" : " · sin la descripción completa"}
                  </dd>
                </dl>
              </details>
            </div>
          </section>

          {/* Score humano: referencia para el golden y para calibrar (PRD §6) */}
          <Verdict
            jobId={job.id}
            evaluationId={ev.id}
            verdict={ev.humanVerdict}
            note={ev.humanNote}
          />
          <details
            open={ev.humanScore !== null}
            className="rounded-md border border-zinc-200 p-3 text-sm"
          >
            <summary className="cursor-pointer font-semibold">Corregir el puntaje</summary>
            {/* key: al guardar un motivo o un score el formulario se remonta con lo guardado */}
            <form
              key={`${ev.humanScore ?? ""}|${ev.humanNote ?? ""}`}
              action={humanScoreAction}
              className="mt-2 flex flex-col gap-2"
            >
              <h2 className="font-semibold">Tu score</h2>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="evaluationId" value={ev.id} />
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-600">
                  Score humano (0–10)
                  <input
                    name="humanScore"
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    inputMode="decimal"
                    defaultValue={ev.humanScore ?? ""}
                    className="w-28 rounded-md border border-zinc-300 px-2 py-2 text-base"
                  />
                </label>
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-zinc-600">
                  Nota
                  <input
                    name="humanNote"
                    type="text"
                    defaultValue={ev.humanNote ?? ""}
                    placeholder="por qué difiere del modelo"
                    className="rounded-md border border-zinc-300 px-2 py-2 text-base"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
                >
                  Guardar
                </button>
              </div>
              {ev.humanScore !== null ? (
                <p className="text-xs text-zinc-600">
                  guardado: {ev.humanScore} · diferencia con el modelo{" "}
                  {(ev.humanScore - ev.score).toFixed(1)}
                </p>
              ) : null}
            </form>
          </details>
        </>
      ) : job.preScore ? (
        <section className="flex flex-col gap-2 rounded-md border-2 border-dashed border-zinc-400 p-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Sin evaluar</h2>
            <span className="text-lg font-semibold">
              Estimación previa {formatScore(job.preScore.score)}
            </span>
          </div>
          <p className="text-xs text-zinc-600">
            La IA todavía no evaluó esta oferta. La estimación previa sale de reglas, sin
            inteligencia artificial: skills del aviso contra tu nivel, riesgos y salario contra tu
            piso. No es la evaluación completa.
          </p>
          <div>{evaluateNow}</div>
          {job.preScore.riesgos.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-semibold text-amber-900">Riesgos detectados</p>
              <ul className="list-disc pl-5 text-xs text-amber-900">
                {job.preScore.riesgos.map((r) => (
                  <li key={r}>{riskLabel(r)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <SkillBox
              title={`Tenés (${job.preScore.have.length})`}
              items={job.preScore.have}
              tone="text-emerald-900"
            />
            <SkillBox
              title={`Te faltan (${job.preScore.missing.length})`}
              items={job.preScore.missing}
              tone="text-red-900"
            />
            <div className="min-w-0 rounded-md border border-zinc-200 p-2">
              <p className="text-xs font-semibold">
                Sin nivel cargado ({job.preScore.unknownSkills.length})
              </p>
              {job.preScore.unknownSkills.length ? (
                <ul className="mt-1 flex flex-col items-start gap-1">
                  {job.preScore.unknownSkills.map((u) => (
                    <li key={u.slug} className="min-w-0 max-w-full">
                      {isEnglishSkillSlug(u.slug) ? (
                        <span className="text-xs text-zinc-600">{u.name}</span>
                      ) : (
                        <SkillLevelButton
                          slug={u.slug}
                          name={u.name}
                          description={job.skillInfo[u.slug]?.description ?? null}
                          jobId={job.id}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-600">—</p>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-600">
            {job.preScore.skillsMentioned} aptitudes reconocidas en la descripción
            {job.preScore.coverage !== null
              ? ` · cobertura ${(job.preScore.coverage * 100).toFixed(0)} %`
              : ""}
            {job.preScore.cap !== null ? ` · tope por el título ${job.preScore.cap}` : ""}
            {job.preScore.adjustments.length
              ? ` · ${job.preScore.adjustments.map(adjustmentText).join(", ")}`
              : ""}
          </p>
          {job.status === "pendiente_jd" ? (
            <p className="text-xs text-zinc-600">
              Sin descripción: la estimación previa usa solo las señales del aviso y el salario.{" "}
              <Link href="/jobs/pending-jd" className="underline">
                pegar la descripción
              </Link>
            </p>
          ) : null}
        </section>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-600">
          <p>
            Sin evaluación todavía
            {job.prefilterReason ? ` · descartada automáticamente: ${job.prefilterReason}` : ""}
            {job.status === "pendiente_jd" ? (
              <>
                {" "}
                ·{" "}
                <Link href="/jobs/pending-jd" className="underline">
                  pegar la descripción
                </Link>
              </>
            ) : null}
          </p>
          <div>{evaluateNow}</div>
        </div>
      )}

      {/* Formulario de postulación (JS-053, fase 2): se pega, se revisa y se copia; la app no envía nada */}
      <section
        aria-label="Formulario de postulación"
        className="rounded-md border border-zinc-200 p-3 text-sm"
      >
        <h2 className="font-semibold">Formulario de postulación</h2>
        <p className="mb-2 text-xs text-zinc-600">
          Pegá las preguntas, revisá los borradores y copiá lo aprobado. Nada se envía desde acá.
        </p>
        {savedForm.length ? (
          <details className="mb-2 rounded-md bg-zinc-50 p-2">
            <summary className="cursor-pointer text-xs font-semibold">
              Respuestas guardadas ({savedForm.length})
            </summary>
            <dl className="mt-1 flex flex-col gap-1 text-xs">
              {savedForm.map((qa, i) => (
                <div key={i}>
                  <dt className="font-medium text-zinc-800">{qa.question}</dt>
                  <dd className="whitespace-pre-wrap text-zinc-600">{qa.answer}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        <FormReview jobId={job.id} />
      </section>

      <section className="text-sm">
        <h2 className="font-semibold">Fuentes</h2>
        <ul className="mt-1 flex flex-col gap-1">
          {job.sources.map((src, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                {SOURCE_LABELS[src.kind] ?? src.kind}
              </span>
              {src.name ? <span className="text-zinc-600">{src.name}</span> : null}
              {safeHttpUrl(src.url) ? (
                <a
                  href={safeHttpUrl(src.url) ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-sky-700 underline"
                >
                  {src.url}
                </a>
              ) : null}
              <span className="text-zinc-600">{formatDate(src.seenAt)}</span>
            </li>
          ))}
        </ul>
        {flagTexts.length ? (
          <p className="mt-2 text-xs text-zinc-600">Señales del aviso: {flagTexts.join(", ")}</p>
        ) : null}
      </section>

      {job.jdText ? (
        <details className="rounded-md border border-zinc-200 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Descripción del puesto</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-zinc-800">
            {job.jdText}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function SkillBox({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-2">
      <p className="text-xs font-semibold">{title}</p>
      {items.length ? (
        <p className={`text-xs ${tone}`}>{items.join(" · ")}</p>
      ) : (
        <p className="text-xs text-zinc-600">—</p>
      )}
    </div>
  );
}

function Block({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 text-sm">
      <h2 className="font-semibold">{title}</h2>
      {items.length ? (
        <ul className={`mt-1 list-disc pl-5 ${tone}`}>
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-zinc-600">—</p>
      )}
    </div>
  );
}
