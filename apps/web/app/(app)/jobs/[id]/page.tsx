import {
  affinityBreakdown,
  applyRequirementAnswers,
  fieldKeyOf,
  summarizeRequirements,
  withCurrentProfileFacts,
  englishIsNotAGap,
  fitCrossSentence,
  isEnglishGap,
  isEnglishSkillSlug,
  visibleRisks,
  withCurrentSkillLevels,
  withMustGaps,
  type JobEvent,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RequisitosDelAviso } from "@/components/requisitos-del-aviso";
import { SkillLevelButton } from "@/components/skill-level-modal";
import { notEvaluatedMessage } from "@/lib/evaluate-now";
import { getMainFitSummary } from "@/lib/fit";
import { adjustmentLine } from "@/lib/adjustment-line";
import { isUuid } from "@/lib/ids";
import { getJobDetail } from "@/lib/job-detail";
import { jobNeighbors, listQuery, parseJobFilters } from "@/lib/jobs";
import {
  COMPANY_TYPE_LABEL,
  DEMO_BADGE_CLASSES,
  DEMO_MODEL,
  DISCIPLINE_LABEL,
  flagLabel,
  formatDate,
  formatScore,
  formatScoreNumber,
  MODALITY_LABELS,
  OUTCOME_LABELS,
  riskLabel,
  safeHttpUrl,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "@/lib/labels";
import { loadPerfilActual } from "@/lib/ficha-context";
import { getJobCardFor } from "@/lib/job-card";
import { loadOpenOfferTables } from "@/lib/ofertas-abiertas";
import { canViewRecorrido } from "@/lib/recorrido-access";
import { loadRequirementAnswers, requirementAnswersAllowedFor } from "@/lib/requirement-answers";
import { requireUserId } from "@/lib/session";
import { DETALLE_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { AfiFestejo } from "@/components/afi-festejo";
import { changeStatusAction, dismissDuplicateAction } from "./actions";
import { AutoRefresh } from "../auto-refresh";
import { AffinityDetail } from "./affinity-detail";
import { ApplyButton } from "./apply-button";
import { ComoEncaja } from "./como-encaja";
import { ConditionsBlock } from "./conditions-block";
import { TransparencyBlock } from "./transparency-block";
import { getSavedFormAnswers } from "./form-data";
import { FormReview } from "./form-review";
import { MergeButton } from "./merge-button";
import { EvaluateNow } from "./evaluate-now";
import { ProponerPuntaje } from "./proponer-puntaje";
import { FichaEstadoView, PocasPalabras, QueBuscan, QueVasAHacer } from "./ficha-bloques";
import { retryJobCardAction } from "./ficha-actions";
import { fichaView, habilidadesDelPuesto } from "./ficha-view";
import { RepetidoCampo } from "./repetido-campo";
import { editableField, repetidoView } from "./repetido-view";
import { postularChecklist } from "./postular/postular-view";
import { ListingState } from "../listing-state";
import { SaveButton, SavedMark } from "../save-button";
import { ReviewNav } from "./review-nav";
import { SourceAttribution } from "./source-attribution";
import { StatusCorrection } from "./status-correction";
import { Verdict } from "./verdict";
import { OfferD3 } from "@/components/offer-d3";
import { buttonClasses } from "@/components/ui";
import { HelpTip } from "@/components/help-tip";

export const dynamic = "force-dynamic";

export const metadata = { title: "Oferta" };

const T = DETALLE_TEXTOS;

const EVENT_LABELS: Record<JobEvent, string> = {
  prefilter_pass: "Pasó los filtros",
  prefilter_discard: "Descartar automáticamente",
  needs_jd: "Falta la descripción",
  evaluated: "Evaluada",
  apply: T.estado.marcarPostulada,
  discard: "Descartar",
  auto_reject: "Rechazo automático",
  reject: "Rechazada",
  interview: "Entrevista",
  offer: "Oferta",
  close: "Cerrar oferta",
};

const ERRORS: Record<string, string> = {
  evento: "Evento desconocido.",
  transicion: "Esa transición no vale desde el estado actual (la página estaba desactualizada).",
  score: "Tu puntaje va de 0 a 10 en pasos de 0,5.",
  correccion: "Esa corrección no vale desde el estado actual (la página estaba desactualizada).",
  fusion:
    "No se pudo fusionar: las ofertas cambiaron (una ya tiene evaluación o postulación, o se está evaluando). Recargá y revisá.",
  evaluar: "No se puede evaluar esta oferta: no tiene la descripción del puesto.",
  veredicto: "No se pudo guardar tu respuesta: la evaluación ya no existe. Recargá la página.",
  motivo:
    "No se pudo guardar el motivo: admite hasta 140 caracteres y la evaluación tiene que existir.",
  permiso: "Esta acción es solo para quienes prueban la app.",
};

/** Sección plegable de la evaluación completa: igual en la computadora y en el celular. */
function Seccion({
  id,
  titulo,
  abierta = false,
  children,
}: {
  id: string;
  titulo: string;
  abierta?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={abierta}
      data-testid={`seccion-${id}`}
      className="rounded-card border border-line p-3 text-sm"
    >
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
        {titulo}
      </summary>
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </details>
  );
}

/** Detalle de una oferta (JS-016, rehecho en R30-08/09/10/11): qué dice el aviso, cómo encaja y cómo postularte. */
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
  const [job, around, savedForm, fichaView0] = await Promise.all([
    getJobDetail(userId, id),
    jobNeighbors(userId, id, filters),
    getSavedFormAnswers(userId, id),
    // R31: la ficha del aviso. Con `JOB_CARD` apagada responde `apagada` sin consultar nada
    getJobCardFor(userId, id),
  ]);
  if (!job) notFound();
  const flagTexts = job.flags.flatMap((f) => flagLabel(f) ?? []);
  const jobUrl = safeHttpUrl(job.url);
  const ev = job.evaluation;
  // «Proponer otro puntaje»: solo testers y admins (también se valida en la action)
  const canPropose = ev ? await canViewRecorrido(userId) : false;
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
  // R11-11: los niveles de hoy y los excluyentes que nombra la evaluación («X (must)») entran en
  // la cuenta de «Requisitos»; los riesgos que hablan de un tema con excluyente no van en «no frenan»
  const skillsAll = ev?.checklist ? withCurrentSkillLevels(ev.checklist, currentLevels) : null;
  // Sin JOB_CARD para esta persona no se ofrece la pregunta de un toque: la tabla es la de la R30
  const fichaAllowed = skillsAll ? await requirementAnswersAllowedFor(userId) : false;
  const skillsNow =
    skillsAll && !fichaAllowed
      ? { ...skillsAll, items: skillsAll.items.map(({ pregunta: _p, ...rest }) => rest) }
      : skillsAll;
  // R31-05 y R31-08 (solo con JOB_CARD): las respuestas de un toque y el inglés y los años de hoy se
  // superponen a la tabla guardada, sin volver a evaluar. Apagada, la tabla queda como en la R30.
  const fichaOn = fichaAllowed;
  const answers = fichaOn ? await loadRequirementAnswers(userId) : null;
  const perfilActual = fichaOn ? await loadPerfilActual(userId) : null;
  const checklistNow =
    skillsNow && answers && perfilActual
      ? applyRequirementAnswers(withCurrentProfileFacts(skillsNow, perfilActual), answers)
      : skillsNow;
  const requisitos = checklistNow && ev ? withMustGaps(checklistNow, ev.gaps) : null;
  // R31-08: «Esto mismo te pasa en N de tus M ofertas» junto a lo que más pesa
  const repetido =
    requisitos && answers && perfilActual
      ? await (async () => {
          const pesa = summarizeRequirements(requisitos).weighing.find(
            (r) => r.state !== "coincide" && editableField(fieldKeyOf(r.id)) !== null,
          );
          if (!pesa) return null;
          const tables = await loadOpenOfferTables(userId, perfilActual, answers);
          return repetidoView(tables, fieldKeyOf(pesa.id));
        })()
      : null;
  const risks = ev ? visibleRisks(ev.riesgos.map(riskLabel), requisitos?.items) : [];
  const noEnglishGap = englishIsNotAGap(job.jdText, null);
  const salary =
    job.salaryMinUsd || job.salaryMaxUsd
      ? `USD ${[job.salaryMinUsd, job.salaryMaxUsd].filter(Boolean).join("–")}${job.salaryPeriod ? ` ${job.salaryPeriod}` : ""}`
      : null;
  // R30-09: las habilidades salen de la tabla de requisitos (las que el aviso menciona). Separar las
  // del puesto de las que hablan de la empresa queda para la R31.
  // R31-07: con ficha lista, solo las habilidades ligadas al puesto; sin ficha (o apagada), como la R30
  const card = fichaView0.status === "lista" ? fichaView0.card : null;
  const fichaVista = card ? fichaView(card) : null;
  const skillRows = habilidadesDelPuesto(
    (requisitos?.items ?? []).filter((i) => i.kind === "skill"),
    card ? card.habilidades : null,
  );
  // R30-10: pasos finales (hasta 5) de la sección «Preparar mi postulación»
  const pasos = postularChecklist({ hasAnswers: savedForm.length > 0, hasCover: false });

  return (
    <article
      data-ancho="completo"
      className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-28 sm:pt-8 sm:pb-10"
    >
      {/* En el celular, el botón de salida queda arriba y fijo, sin tapar la barra de abajo */}
      {jobUrl ? (
        <div
          data-testid="salida-cel"
          className="sticky top-0 z-30 -mx-4 flex flex-col gap-1 bg-surface px-4 py-2 sm:hidden"
        >
          <ApplyButton
            jobId={job.id}
            url={jobUrl}
            canApply={job.events.includes("apply")}
            className="w-full"
          />
          <p className="text-xs text-fg-muted">{T.postular.aviso}</p>
        </div>
      ) : null}
      {/* D3 (C10-8): copia de detalle-cel.png y del panel de ofertas-pc.png */}
      <OfferD3
        job={job}
        variant="page"
        backHref={`/jobs${query}`}
        actions={
          jobUrl ? (
            <div className="hidden flex-col gap-1 sm:flex">
              <ApplyButton jobId={job.id} url={jobUrl} canApply={job.events.includes("apply")} />
              <p className="max-w-xs text-xs text-fg-muted">{T.postular.aviso}</p>
            </div>
          ) : null
        }
      />
      <ReviewNav
        backHref={`/jobs${query}`}
        prevHref={around.prev ? `/jobs/${around.prev}${query}` : null}
        nextHref={around.next ? `/jobs/${around.next}${query}` : null}
      />
      {/* R30-03 y R30-07: marca «Guardada», Guardar/Quitar y vigencia del aviso (del pool) */}
      {/* Sin consulta extra: «Guardada» sale de la fila que ya se leyó. Solo las ofertas del pool
          consultan la vigencia (las demás no afirman nada). */}
      {job.fromPool ? (
        <ListingState userId={userId} jobId={job.id} title={job.title} />
      ) : (
        <div className="flex flex-wrap items-center gap-2" data-testid="detalle-listado">
          {job.savedAt ? <SavedMark /> : null}
          <SaveButton jobId={job.id} title={job.title} saved={job.savedAt !== null} />
        </div>
      )}
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {ERRORS[error] ?? "No pudimos hacerlo. Recargá la página y probá otra vez."}
        </p>
      ) : null}
      {capNotice ? (
        <p role="status" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          {capNotice}
        </p>
      ) : null}
      {job.evaluating && !capNotice ? (
        <p role="status" className="rounded-control bg-info-soft px-3 py-2 text-sm text-info">
          En cola para evaluar. Puede tardar de unos segundos a unas horas; esta página se actualiza
          sola un rato.
        </p>
      ) : null}
      <AutoRefresh active={job.evaluating} />

      {/* Datos del aviso y etiquetas (lo que el resumen D3 no muestra) */}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-fg-subtle">
          {[
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
        <div className="mt-1 flex flex-wrap gap-1 text-xs">
          {ev?.model === DEMO_MODEL ? (
            <span className={DEMO_BADGE_CLASSES} title="Evaluación falsa del modo demo, sin LLM">
              DEMO · evaluación falsa
            </span>
          ) : null}
          <span className="rounded-badge bg-surface-muted px-1.5 py-0.5 text-fg-muted">
            {STATUS_LABELS[job.status] ?? job.status}
          </span>
          {/* R30-09 / regla 2: sin «Te conviene…» ni «Ubicación: no». Lo que el aviso exige se
              explica en la tabla de requisitos, aparte de la afinidad */}
          {job.badges.map((b) => (
            <span key={b} className="rounded-badge bg-surface-subtle px-1.5 py-0.5 text-fg-subtle">
              {b}
            </span>
          ))}
        </div>
      </div>

      {/* R31-04: «La oferta en pocas palabras», o el estado de la ficha. Apagada: nada (R30 igual). */}
      {fichaVista ? (
        <PocasPalabras view={fichaVista} />
      ) : fichaView0.status !== "apagada" && fichaView0.status !== "lista" ? (
        <FichaEstadoView
          status={fichaView0.status}
          jobId={job.id}
          retryAction={retryJobCardAction}
        />
      ) : null}

      {/* 3 · Lo importante para decidir: las 7 filas, solo con lo que dice el aviso */}
      <ConditionsBlock
        input={{
          salaryMinUsd: job.salaryMinUsd,
          salaryMaxUsd: job.salaryMaxUsd,
          salaryPeriod: job.salaryPeriod,
          modality: job.modality,
          englishRequired: ev?.englishRequired ?? null,
          yearsRequired: ev?.yearsRequired ?? null,
          contractType: job.contractType,
          countriesAllowed: job.countriesAllowed,
          weeklyHours: job.weeklyHours,
          ficha: card?.condiciones ?? null,
          fichaRequisitos: card?.requisitos,
        }}
      />

      {ev ? (
        <>
          {/* 4 · Cómo encaja: veredicto y lo que más pesa, desde la tabla de requisitos */}
          <ComoEncaja checklist={requisitos} />
          {repetido ? (
            <RepetidoCampo field={repetido.field} jobId={job.id} textos={repetido.textos} />
          ) : null}
          {crossLine ? (
            <p data-testid="encaje-cruce" className="text-sm text-fg-muted">
              {crossLine}{" "}
              <Link
                href="/encaje"
                className="inline-flex min-h-11 items-center font-medium text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                Ver Tu encaje
              </Link>
            </p>
          ) : null}
          {/* C8-6: qué es el número del puntaje */}
          <HelpTip topic="puntaje" />
          {/* R17-03 / R30-02: aclaración fija (siempre visible) y «Cómo calculamos la afinidad» */}
          <AffinityDetail
            items={affinityBreakdown({
              matchFuerte: ev.matchFuerte,
              gaps: noEnglishGap ? ev.gaps.filter((g) => !isEnglishGap(g)) : ev.gaps,
              riesgos: risks,
              bloqueadores: ev.bloqueadores,
              adjustments: ev.adjustments,
              yearsRequired: ev.yearsRequired,
              locationOk: ev.locationOk,
              modality: ev.modality,
              englishRequired: ev.englishRequired,
              englishGap: !noEnglishGap && ev.gaps.some(isEnglishGap),
              salaryMinUsd: job.salaryMinUsd,
              salaryMaxUsd: job.salaryMaxUsd,
            })}
          />
        </>
      ) : (
        /* Antes de evaluar (plan §4): «Sin evaluar», botón y estimación provisoria plegada */
        <section
          data-testid="antes-de-evaluar"
          className="flex flex-col gap-2 rounded-card border-2 border-dashed border-line-control p-3 text-sm"
        >
          <p>
            {T.antes.texto}
            {job.prefilterReason ? ` Descartada automáticamente: ${job.prefilterReason}.` : ""}
            {job.status === "pendiente_jd" ? (
              <>
                {" "}
                <Link href="/jobs/pending-jd" className="underline">
                  Pegar la descripción
                </Link>
              </>
            ) : null}
          </p>
          <div>{evaluateNow}</div>
          {job.preScore ? (
            <details data-testid="estimacion-provisoria" className="text-xs text-fg-muted">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium">
                {T.antes.provisoria}
              </summary>
              <p>{llenarTexto(T.antes.provisoriaNumero, { n: formatScore(job.preScore.score) })}</p>
              <p className="mt-1">{T.antes.provisoriaTexto}</p>
              {job.preScore.adjustments.length ? (
                <p className="mt-1">{job.preScore.adjustments.map(adjustmentLine).join(", ")}</p>
              ) : null}
              {job.preScore.riesgos.length ? (
                <>
                  <p className="mt-1 font-medium">{T.antes.riesgos}</p>
                  <ul className="list-disc pl-5">
                    {job.preScore.riesgos.map((r) => (
                      <li key={r}>{riskLabel(r)}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </details>
          ) : null}
        </section>
      )}

      {/* Antes de evaluar también se puede cargar el nivel de las habilidades que menciona el aviso */}
      {!ev &&
      job.preScore &&
      job.preScore.unknownSkills.some((u) => !isEnglishSkillSlug(u.slug)) ? (
        <Seccion id="habilidades" titulo={T.secciones.habilidades}>
          <p className="text-xs text-fg-muted">{T.habilidades.intro}</p>
          <ul className="flex flex-col gap-2">
            {job.preScore.unknownSkills
              .filter((u) => !isEnglishSkillSlug(u.slug))
              .map((u) => (
                <li
                  key={u.slug}
                  data-testid={`habilidad-${u.slug}`}
                  className="flex flex-col gap-0.5"
                >
                  <span className="font-medium">{u.name}</span>
                  <span className="text-xs text-fg-muted">{T.habilidades.mencionada}</span>
                  <span className="text-xs text-fg-muted">{T.habilidades.sinCargar}</span>
                  <SkillLevelButton
                    slug={u.slug}
                    name={u.name}
                    description={job.skillInfo[u.slug]?.description ?? null}
                    jobId={job.id}
                  />
                </li>
              ))}
          </ul>
        </Seccion>
      ) : null}

      {/* R31-04: «Qué vas a hacer» y «Qué buscan», solo con la ficha lista */}
      {fichaVista ? (
        <>
          <QueVasAHacer view={fichaVista} />
          <QueBuscan view={fichaVista} />
        </>
      ) : null}

      {/* R17-05: transparencia del aviso, calculada al mostrar */}
      <TransparencyBlock
        input={{
          title: job.title,
          company: job.company,
          jdText: job.jdText,
          locationRaw: job.locationRaw,
          countriesAllowed: job.countriesAllowed,
          modality: job.modality,
          salaryMinUsd: job.salaryMinUsd,
          salaryMaxUsd: job.salaryMaxUsd,
          yearsRequired: ev?.yearsRequired ?? null,
        }}
      />

      {/* 7 · La evaluación completa, en secciones plegables */}
      {requisitos ? (
        <Seccion id="requisitos" titulo={T.secciones.requisitos} abierta>
          <RequisitosDelAviso
            checklist={requisitos}
            modal={{ jobId: job.id, skillInfo: job.skillInfo }}
            rebuilt={ev?.checklistRebuilt}
            hideNamedSkills
          />
        </Seccion>
      ) : null}

      {ev ? (
        <Seccion id="habilidades" titulo={T.secciones.habilidades}>
          <p className="text-xs text-fg-muted">{T.habilidades.intro}</p>
          {skillRows.length ? (
            <ul className="flex flex-col gap-2">
              {skillRows.map((s) => {
                const slug = s.id.slice("skill:".length);
                return (
                  <li
                    key={s.id}
                    data-testid={`habilidad-${slug}`}
                    className="flex flex-col gap-0.5"
                  >
                    <span className="font-medium">{s.pide.replace(/^Menciona\s+/i, "")}</span>
                    <span className="text-xs text-fg-muted">{T.habilidades.mencionada}</span>
                    {s.tenes !== null ? (
                      <span className="text-xs text-fg-muted">
                        {s.tenes.replace(/^Nivel (\d) de 3$/, (_m, n: string) =>
                          llenarTexto(T.habilidades.nivel, { n }),
                        )}
                      </span>
                    ) : (
                      <>
                        <span className="text-xs text-fg-muted">{T.habilidades.sinCargar}</span>
                        {job.skillInfo[slug] ? (
                          <SkillLevelButton
                            slug={slug}
                            name={s.pide.replace(/^Menciona\s+/i, "")}
                            description={job.skillInfo[slug]?.description ?? null}
                            jobId={job.id}
                          />
                        ) : (
                          // Fuera de la taxonomía no hay modal: se carga en Ajustes
                          <Link
                            href="/settings/skills"
                            className="inline-flex min-h-11 w-fit items-center font-semibold text-link underline underline-offset-2"
                          >
                            {llenarTexto(T.habilidades.cargar, {
                              nombre: s.pide.replace(/^Menciona\s+/i, ""),
                            })}
                          </Link>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-fg-muted">{T.habilidades.vacio}</p>
          )}
        </Seccion>
      ) : null}

      {ev ? (
        <Seccion id="como-se-calculo" titulo={T.secciones.comoSeCalculo}>
          {ev.veredicto ? <p className="text-fg">{ev.veredicto}</p> : null}
          <p className="text-xs text-fg-subtle">
            La IA lee el aviso y tu perfil y propone un puntaje. Después la app aplica reglas fijas
            que lo suben o lo bajan.
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <dt>Área del aviso</dt>
            <dd>{DISCIPLINE_LABEL[ev.discipline] ?? ev.discipline}</dd>
            <dt>Tipo de empresa</dt>
            <dd>
              {ev.companyType
                ? (COMPANY_TYPE_LABEL[ev.companyType] ?? ev.companyType)
                : COMPANY_TYPE_LABEL.desconocido}
            </dd>
            <dt>Puntaje de la IA</dt>
            <dd>{formatScoreNumber(ev.scoreModel ?? ev.score)}</dd>
            <dt>Ajustes</dt>
            <dd>
              {ev.adjustments.length ? (
                <ul>
                  {ev.adjustments.map((a, i) => (
                    <li key={`${i}|${a.rule}`}>{adjustmentLine(a)}</li>
                  ))}
                </ul>
              ) : (
                "ninguno"
              )}
            </dd>
            <dt>Puntaje final</dt>
            <dd>{formatScoreNumber(ev.score)}</dd>
            <dt>Fecha de la evaluación</dt>
            <dd>
              {formatDate(ev.createdAt)}
              {ev.hadFullJd ? "" : " · sin la descripción completa"}
            </dd>
          </dl>
          {risks.length ? (
            <div data-testid="riesgos">
              <h3 className="text-xs font-semibold">
                {llenarTexto(T.riesgos.titulo, { n: risks.length })}
              </h3>
              <ul className="list-disc pl-5 text-xs text-fg-muted">
                {risks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Seccion>
      ) : null}

      <Seccion id="preparar" titulo={T.secciones.preparar}>
        <p className="text-xs text-fg-muted">{T.preparar.intro}</p>
        {savedForm.length ? (
          <details className="rounded-control bg-surface-subtle p-2">
            <summary className="cursor-pointer text-xs font-semibold">
              {llenarTexto(T.preparar.guardadas, { n: savedForm.length })}
            </summary>
            <dl className="mt-1 flex flex-col gap-1 text-xs">
              {savedForm.map((qa, i) => (
                <div key={i}>
                  <dt className="font-medium text-fg">{qa.question}</dt>
                  <dd className="whitespace-pre-wrap text-fg-subtle">{qa.answer}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        <FormReview jobId={job.id} />
        <div>
          <h3 className="text-xs font-semibold">{T.preparar.pasos}</h3>
          <ol className="mt-1 list-decimal pl-5 text-fg">
            {pasos.map((p) => (
              <li key={p.key} className="py-0.5">
                {p.text}
              </li>
            ))}
          </ol>
        </div>
        <Link
          href={`/jobs/${job.id}/postular`}
          className={`${buttonClasses({ size: "sm", variant: "secondary" })} w-fit`}
        >
          {T.preparar.cv}
        </Link>
        {/* «Ver el aviso original» no va acá: lleva al mismo lugar que el botón de salida */}
      </Seccion>

      {/* Acciones de estado: Server Actions + transition(); solo los eventos válidos desde el estado actual */}
      <section aria-label="Estado" className="flex flex-wrap gap-2">
        {job.events.map((event) => (
          <form key={event} action={changeStatusAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="event" value={event} />
            <button
              type="submit"
              // C9-9: con las primitivas; «Ya me postulé» se destaca sin usar la lima (es un estado)
              className={buttonClasses({
                size: "sm",
                variant: event === "apply" ? "dark" : "secondary",
              })}
            >
              {EVENT_LABELS[event]}
            </button>
          </form>
        ))}
        {job.application?.appliedAt ? (
          <p className="self-center text-xs text-fg-subtle">
            {llenarTexto(T.estado.postuladaEl, { fecha: formatDate(job.application.appliedAt) })}
            {job.application.outcome
              ? ` · ${OUTCOME_LABELS[job.application.outcome] ?? job.application.outcome}`
              : ""}
          </p>
        ) : null}
      </section>
      {/* R27-04: festeja una sola vez cuando la postulación pasa a enviada con la pantalla abierta */}
      <AfiFestejo
        festejo="postulacion"
        modo="cambio"
        cumplido={Boolean(job.application?.appliedAt)}
      />
      {/* Atribución exigida por las fuentes públicas: mención + enlace al aviso original */}
      <SourceAttribution
        sources={job.sources}
        company={job.company}
        jdText={job.jdText}
        exitUrl={jobUrl}
      />
      {job.corrections.length ? (
        <StatusCorrection jobId={job.id} current={job.status} targets={job.corrections} />
      ) : null}

      {/* Posible duplicado (JS-025, ADR-013): parecido por empresa y título, sin nada que lo identifique */}
      {job.possibleDuplicateOf ? (
        <section
          aria-label="Posible duplicado"
          className="flex flex-col gap-2 rounded-card border border-warning-line bg-warning-soft p-3 text-sm"
        >
          <h2 className="font-semibold text-warning">Posible duplicado</h2>
          <p className="text-warning">
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
            <p className="text-xs text-warning">
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
              <button type="submit" className={buttonClasses({ size: "sm", variant: "secondary" })}>
                No son la misma
              </button>
            </form>
          </div>
        </section>
      ) : null}
      {job.possibleDuplicates.length ? (
        <section
          aria-label="Posibles duplicados de esta oferta"
          className="rounded-card border border-warning-line p-3 text-sm"
        >
          <h2 className="font-semibold text-warning">
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
                <span className="text-xs text-fg-subtle">
                  {STATUS_LABELS[d.status] ?? d.status} · se revisa desde su detalle
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {ev ? (
        <>
          {/* R30-11: «¿Te sirve esta evaluación?» y, solo para testers y admins, «Proponer otro puntaje» */}
          <Verdict
            jobId={job.id}
            evaluationId={ev.id}
            verdict={ev.humanVerdict}
            note={ev.humanNote}
          />
          {canPropose ? (
            <ProponerPuntaje
              jobId={job.id}
              evaluationId={ev.id}
              score={ev.score}
              humanScore={ev.humanScore}
              humanNote={ev.humanNote}
            />
          ) : null}
        </>
      ) : null}

      <section className="text-sm">
        <h2 className="font-semibold">{T.secciones.fuentes}</h2>
        <ul className="mt-1 flex flex-col gap-1">
          {job.sources.map((src, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-badge bg-info-soft px-1.5 py-0.5 text-info">
                {SOURCE_LABELS[src.kind] ?? src.kind}
              </span>
              {src.name ? <span className="text-fg-subtle">{src.name}</span> : null}
              {safeHttpUrl(src.url) ? (
                <a
                  href={safeHttpUrl(src.url) ?? undefined}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-block max-w-full truncate py-3.5 text-link underline sm:py-0"
                >
                  {src.url}
                </a>
              ) : null}
              <span className="text-fg-subtle">{formatDate(src.seenAt)}</span>
            </li>
          ))}
        </ul>
        {flagTexts.length ? (
          <p className="mt-2 text-xs text-fg-subtle">Señales del aviso: {flagTexts.join(", ")}</p>
        ) : null}
      </section>

      {job.jdText ? (
        <details className="rounded-card border border-line p-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            {T.secciones.descripcion}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-fg">{job.jdText}</pre>
        </details>
      ) : null}
    </article>
  );
}
