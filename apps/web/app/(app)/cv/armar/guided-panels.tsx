"use client";

import {
  cvSoftBulletStatus,
  cvSoftProposals,
  cvTopicSatisfied,
  cvTopicsProgress,
  type CvChatState,
  type CvSoftDecision,
  type CvUiTopic,
} from "@job-search-os/pipeline";
import { buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { CV_ASISTENTE_TEXTOS } from "@/lib/textos-rediseno";

/**
 * Piezas del flujo guiado del chat de CV (R33-03 y R33-04): lista de temas, habilidades blandas por situaciones y
 * resumen profesional. Todo se calcula con funciones puras de `packages/pipeline` sobre el estado de la charla; acá
 * solo se pinta. Nada entra al CV sin el clic de la persona.
 */
const A = CV_ASISTENTE_TEXTOS;

const SECONDARY_SM = buttonClasses({ variant: "secondary", size: "sm" });
const PRIMARY_SM = buttonClasses({ size: "sm" });
const LINK_BUTTON =
  "min-h-11 self-start rounded-control px-1 text-sm font-semibold text-link underline underline-offset-2 disabled:cursor-not-allowed";

const fill = (text: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((t, [k, v]) => t.replace(`{${k}}`, v), text);

/** Marca de cada estado: ícono y texto, nunca solo color. */
const MARK: Record<string, string> = { done: "✓", current: "●", skipped: "↺", pending: "○" };

/**
 * Avance como lista de temas (C-10): el actual marcado, los hechos tildados, los salteados con «Volver a este
 * tema». Son siempre 7 con el flujo guiado.
 */
export function TopicList({
  state,
  disabled,
  onReopen,
}: {
  state: CvChatState;
  disabled: boolean;
  onReopen: (topic: CvUiTopic) => void;
}) {
  const topics = cvTopicsProgress(state);
  return (
    <ol
      className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted"
      aria-label={A.avance.titulo}
      data-testid="cv-topics"
    >
      {topics.map(({ topic, status }) => (
        <li
          key={topic}
          aria-current={status === "current" ? "step" : undefined}
          data-status={status}
          className={`flex items-center gap-1 ${status === "current" ? "font-semibold text-fg" : ""}`}
        >
          <span aria-hidden="true">{MARK[status]}</span>
          <span>{A.avance.temas[topic]}</span>
          <span className="sr-only">: {A.avance.estados[status]}</span>
          {status === "skipped" ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onReopen(topic)}
              className={LINK_BUTTON}
              aria-label={`${A.avance.volverAEsto}: ${A.avance.temas[topic]}`}
            >
              {A.avance.volverAEsto}
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** ¿Ya contestó las cuatro situaciones? Recién ahí se proponen las habilidades. */
export function softPanelReady(state: CvChatState): boolean {
  return (
    state.guided &&
    cvTopicSatisfied(state, "soft_organize") &&
    (cvSoftProposals(state).length > 0 || state.softSkills.length > 0)
  );
}

/**
 * Habilidades blandas propuestas (C-18 a C-20): cada una dice de dónde salió, con la viñeta que se sumaría, y se
 * decide con «Usarla» o «No, gracias». Como máximo 4. Sin ejemplo no hay nada que proponer.
 */
export function SoftPanel({
  state,
  disabled,
  onDecide,
}: {
  state: CvChatState;
  disabled: boolean;
  onDecide: (skill: string, decision: CvSoftDecision) => void;
}) {
  const proposals = cvSoftProposals(state);
  if (proposals.length === 0 && state.softSkills.length === 0) return null;
  const T = A.blandas;
  return (
    <section
      aria-labelledby="cv-blandas"
      data-testid="cv-blandas"
      className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
    >
      <h3 id="cv-blandas" className="text-base font-bold text-fg">
        {T.titulo}
      </h3>
      {proposals.length > 0 ? <p className="text-sm text-fg-muted">{T.intro}</p> : null}
      <ul className="flex flex-col gap-3">
        {proposals.map((p) => (
          <li
            key={p.skill}
            data-testid="cv-blanda"
            className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0"
          >
            <p className="text-sm font-semibold text-fg">{p.skill}</p>
            <p className="text-sm text-fg-muted">
              {p.from ? fill(T.origen, { empresa: p.from }) : T.origenSinEmpresa}
            </p>
            <p
              className="text-sm text-fg-muted [overflow-wrap:anywhere]"
              data-testid="cv-blanda-vineta"
              data-bullet={cvSoftBulletStatus(state, p)}
            >
              {
                {
                  suma: fill(T.vineta, { texto: p.bullet }),
                  sin_lugar: T.vinetaSinLugar,
                  sin_trabajo: T.vinetaSinTrabajo,
                  ya_esta: T.vinetaYaEsta,
                }[cvSoftBulletStatus(state, p)]
              }
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDecide(p.skill, "used")}
                className={PRIMARY_SM}
                aria-label={`${T.usar}: ${p.skill}`}
              >
                {T.usar}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDecide(p.skill, "declined")}
                className={SECONDARY_SM}
                aria-label={`${T.noGracias}: ${p.skill}`}
              >
                {T.noGracias}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {state.softSkills.length > 0 ? (
        <p className="text-sm text-fg" data-testid="cv-blandas-elegidas">
          {fill(T.elegidas, { lista: state.softSkills.join(", ") })}
        </p>
      ) : null}
      <p className="text-sm text-fg-muted">{T.limite}</p>
    </section>
  );
}

/**
 * Resumen profesional en la revisión (C-16 y C-17): un borrador de 2 o 3 frases con lo que contó, en un solo
 * bloque (sin «Objetivo» aparte) y editable. Si lo deja vacío, queda vacío.
 */
export function SummaryField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const T = A.resumen;
  return (
    <section
      aria-labelledby="cv-resumen"
      data-testid="cv-resumen"
      className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
    >
      <h3 id="cv-resumen" className="text-base font-bold text-fg">
        {T.titulo}
      </h3>
      <p id="cv-resumen-ayuda" className="text-sm text-fg-muted">
        {T.ayuda}
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium text-fg">
        {T.etiqueta}
        <textarea
          rows={4}
          maxLength={600}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby="cv-resumen-ayuda"
          className={inputClasses({ multiline: true })}
        />
      </label>
    </section>
  );
}
