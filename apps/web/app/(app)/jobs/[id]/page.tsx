import type { JobEvent } from "@job-search-os/pipeline";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobDetail } from "@/lib/job-detail";
import { jobNeighbors, listQuery, parseJobFilters } from "@/lib/jobs";
import {
  ACTION_LABELS,
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  formatDate,
  LOCATION_CLASSES,
  LOCATION_LABELS,
  SCORE_CLASSES,
  scoreTone,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { changeStatusAction, dismissDuplicateAction, humanScoreAction } from "./actions";
import { AutoRefresh } from "../auto-refresh";
import { ApplyButton } from "./apply-button";
import { MergeButton } from "./merge-button";
import { ReviewNav } from "./review-nav";
import { StatusCorrection } from "./status-correction";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<JobEvent, string> = {
  prefilter_pass: "Prefiltro ok",
  prefilter_discard: "Descartar (prefiltro)",
  needs_jd: "Falta JD",
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
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : undefined;
  // Los filtros de la lista viajan en la URL del detalle (JS-061): "volver" y "siguiente" los
  // respetan, y el orden sale de la misma consulta que la lista.
  const filters = parseJobFilters(sp);
  const query = listQuery(filters);
  const [job, around] = await Promise.all([
    getJobDetail(userId, id),
    jobNeighbors(userId, id, filters),
  ]);
  if (!job) notFound();
  const ev = job.evaluation;
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
      {job.evaluating ? (
        <p role="status" className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Evaluando con el modelo… la página se actualiza sola cuando termine.
        </p>
      ) : null}
      <AutoRefresh active={job.evaluating} />

      <header className="flex gap-3">
        <div
          className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md ring-1 ${SCORE_CLASSES[tone]}`}
        >
          <span className="text-2xl font-semibold leading-none">
            {ev ? ev.score.toFixed(ev.score % 1 ? 1 : 0) : "–"}
          </span>
          <span className="text-[10px] uppercase">score</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">{job.title}</h1>
          <p className="text-sm text-zinc-700">{job.company}</p>
          <p className="text-xs text-zinc-500">
            {[
              job.locationRaw,
              job.modality && job.modality !== "desconocida" ? job.modality : null,
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
                acción: {ACTION_LABELS[ev.accion] ?? ev.accion}
              </span>
            ) : null}
            {ev ? (
              <span className={`rounded px-1.5 py-0.5 ${LOCATION_CLASSES[ev.locationOk] ?? ""}`}>
                {LOCATION_LABELS[ev.locationOk] ?? ev.locationOk}
              </span>
            ) : null}
            {job.badges.map((b) => (
              <span key={b} className="rounded bg-zinc-50 px-1.5 py-0.5 text-zinc-500">
                {b}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Acciones de estado: Server Actions + transition(); solo los eventos válidos desde el estado actual */}
      <section aria-label="Estado" className="flex flex-wrap gap-2">
        {/* Ir a la publicación original; al volver pregunta si hubo postulación (confirmación manual) */}
        {job.url ? (
          <ApplyButton jobId={job.id} url={job.url} canApply={job.events.includes("apply")} />
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
          <p className="self-center text-xs text-zinc-500">
            aplicada el {formatDate(job.application.appliedAt)}
            {job.application.outcome ? ` · ${job.application.outcome}` : ""}
          </p>
        ) : null}
      </section>
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
            misma empresa y título parecido, pero sin URL ni JD en común. Si es el mismo aviso,
            fusionalas; si no, sacá la marca.
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
                <span className="text-xs text-zinc-500">
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
                Bloqueadores ({ev.bloqueadores.length}) · frenan la postulación
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
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <Block title="Match fuerte" items={ev.matchFuerte} tone="text-emerald-900" />
            <Block title="Gaps" items={ev.gaps} tone="text-zinc-800" />
            <Block title="Señales positivas" items={ev.senales} tone="text-zinc-800" />
            <div className="rounded-md border border-zinc-200 p-3 text-sm">
              <h2 className="font-semibold">Veredicto</h2>
              <p className="mt-1 text-zinc-800">{ev.veredicto}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-600">
                <dt>Disciplina</dt>
                <dd>{ev.discipline}</dd>
                <dt>Inglés</dt>
                <dd>{ev.englishRequired}</dd>
                <dt>Años pedidos</dt>
                <dd>{ev.yearsRequired ?? "no dice"}</dd>
                <dt>Empresa</dt>
                <dd>{ev.companyType ?? "desconocido"}</dd>
                <dt>Modelo</dt>
                <dd>
                  {ev.model} · {ev.promptVersion}
                  {ev.hadFullJd ? "" : " · sin JD completa"}
                </dd>
                <dt>Score del modelo</dt>
                <dd>
                  {ev.scoreModel ?? ev.score}
                  {ev.adjustments.length
                    ? ` → ${ev.score} (${ev.adjustments.map((a) => `${a.rule} ${a.delta > 0 ? "+" : ""}${a.delta}`).join(", ")})`
                    : ""}
                </dd>
              </dl>
            </div>
          </section>

          {/* Score humano: referencia para el golden y para calibrar (PRD §6) */}
          <form
            action={humanScoreAction}
            className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm"
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
              <p className="text-xs text-zinc-500">
                guardado: {ev.humanScore} · diferencia con el modelo{" "}
                {(ev.humanScore - ev.score).toFixed(1)}
              </p>
            ) : null}
          </form>
        </>
      ) : job.preScore ? (
        <section className="flex flex-col gap-2 rounded-md border-2 border-dashed border-zinc-400 p-3 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">Pre-evaluación determinista · sin LLM</h2>
            <span className="text-lg font-semibold">pre-score {job.preScore.score}</span>
          </div>
          <p className="text-xs text-zinc-500">
            El modelo todavía no corrió. Esto sale de reglas: skills de la JD contra tu nivel,
            riesgos del prefiltro y salario contra el piso. No es el score del evaluador.
          </p>
          {job.preScore.riesgos.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-semibold text-amber-900">Riesgos detectados</p>
              <ul className="list-disc pl-5 text-xs text-amber-900">
                {job.preScore.riesgos.map((r) => (
                  <li key={r}>{r}</li>
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
            <SkillBox
              title={`Sin nivel cargado (${job.preScore.unknown.length})`}
              items={job.preScore.unknown}
              tone="text-zinc-600"
            />
          </div>
          <p className="text-xs text-zinc-500">
            {job.preScore.skillsMentioned} skills mapeadas en la JD
            {job.preScore.coverage !== null
              ? ` · cobertura ${(job.preScore.coverage * 100).toFixed(0)} %`
              : ""}
            {job.preScore.cap !== null ? ` · cap por título ${job.preScore.cap}` : ""} ·{" "}
            {job.preScore.adjustments
              .map((a) => `${a.rule} ${a.delta > 0 ? "+" : ""}${a.delta}`)
              .join(", ")}
          </p>
          {job.status === "pendiente_jd" ? (
            <p className="text-xs text-zinc-500">
              Sin JD: el pre-score usa solo flags y salario.{" "}
              <Link href="/jobs/pending-jd" className="underline">
                pegar la JD
              </Link>
            </p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-600">
          Sin evaluación todavía
          {job.prefilterReason ? ` · prefiltro: ${job.prefilterReason}` : ""}
          {job.status === "pendiente_jd" ? (
            <>
              {" "}
              ·{" "}
              <Link href="/jobs/pending-jd" className="underline">
                pegar la JD
              </Link>
            </>
          ) : null}
        </p>
      )}

      <section className="text-sm">
        <h2 className="font-semibold">Fuentes</h2>
        <ul className="mt-1 flex flex-col gap-1">
          {job.sources.map((src, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">
                {SOURCE_LABELS[src.kind] ?? src.kind}
              </span>
              {src.name ? <span className="text-zinc-600">{src.name}</span> : null}
              {src.url ? (
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-sky-700 underline"
                >
                  {src.url}
                </a>
              ) : null}
              <span className="text-zinc-400">{formatDate(src.seenAt)}</span>
            </li>
          ))}
        </ul>
        {job.flags.length ? (
          <p className="mt-2 text-xs text-zinc-500">flags: {job.flags.join(", ")}</p>
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
        <p className="text-xs text-zinc-400">—</p>
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
        <p className="mt-1 text-xs text-zinc-400">—</p>
      )}
    </div>
  );
}
