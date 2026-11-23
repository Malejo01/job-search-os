"use client";

import { lazy, Suspense, useId, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  INTERVIEW_ANSWER_MAX_CHARS,
  buildInterviewReport,
  interviewScoreLevel,
  type InterviewScoreLevel,
} from "@job-search-os/pipeline";
import { joinDictated } from "@/components/dictar-engine";
import { VoiceInput } from "@/components/voice-input-lazy";
import { PrintButton } from "@/components/print-button";
import { Alert, Button, buttonClasses, Card, inputClasses, labelClasses } from "@/components/ui";
import { answerInterviewAction } from "../actions";
import { ANSWER_ERRORS, CRITERIA, formatAverage, scoreWord } from "../copy-cliente";
import { INTERVIEW_CLIENTE as INTERVIEW_TEXTOS } from "@/lib/textos-interview";
import { AnswerSkeleton } from "./answer-skeleton";
import type { RetrySource } from "./retry-button";

// R23-09: el informe y «Practicar de nuevo» solo se ven al terminar; se cargan recién ahí y no suman
// al First Load. `lazy` y no `next/dynamic`: este último agrega su propio cargador al bundle.
const InterviewReportView = lazy(() =>
  import("./report").then((m) => ({ default: m.InterviewReportView })),
);
const RetryButton = lazy(() => import("./retry-button").then((m) => ({ default: m.RetryButton })));

export type AnswerView = {
  position: number;
  answer: string;
  clarity: number;
  relevance: number;
  star: number;
  tip: string;
  example: string;
};

const TOTAL = 5;
/** Errores de envío que se arreglan probando de nuevo con el mismo texto (los demás piden cambiar algo). */
const RETRYABLE = new Set(["busy", "llm_failed", "server", "capped"]);

/** Los tres puntajes de una respuesta con su palabra. El número y la palabra siempre van juntos. */
function Scores({
  item,
  starHelp,
}: {
  item: Pick<AnswerView, "clarity" | "relevance" | "star">;
  starHelp?: ReactNode;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {CRITERIA.map(({ key, label }) => {
        const value = item[key];
        const level: InterviewScoreLevel = interviewScoreLevel(value);
        return (
          <div key={key} className="rounded-control bg-surface-muted p-3">
            <dt className="flex items-center text-[13px] font-extrabold text-fg-muted">
              {label}
              {key === "star" ? starHelp : null}
            </dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-fg">{value}</span>
              <span className="text-sm font-semibold text-fg-muted">
                de 10 · {scoreWord(level)}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function FeedbackCard({ item, starHelp }: { item: AnswerView; starHelp?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" data-testid="interview-feedback">
      <Scores item={item} starHelp={starHelp} />
      <div>
        <h2 className="text-[13px] font-extrabold text-fg-muted">Un consejo</h2>
        <p className="mt-1 text-base text-fg" data-testid="interview-tip">
          {item.tip}
        </p>
      </div>
      <div>
        <h2 className="text-[13px] font-extrabold text-fg-muted">Cómo podría sonar mejor</h2>
        <p className="mt-1 rounded-control bg-surface-muted p-3 text-base text-fg">
          {item.example}
        </p>
      </div>
    </div>
  );
}

/**
 * La simulación: una pregunta por vez en una tarjeta índigo con el progreso en lima («Pregunta N de 5»), un
 * campo para responder y, al enviar, la devolución. Client Component porque guarda el avance y llama a la
 * acción del servidor. Nada de lo que vuelve se inyecta como HTML: todo es texto de React.
 */
export function Simulator({
  sessionId,
  title,
  questions,
  initialAnswers,
  source,
  starHelp,
  serverTranscribe,
}: {
  /** R25-05: la persona puede transcribir en el servidor (viene de `voiceServerAllowedFor`). */
  serverTranscribe: boolean;
  sessionId: string;
  title: string;
  questions: string[];
  initialAnswers: AnswerView[];
  source: RetrySource;
  /** «?» del método STAR: Server Component armado en la página y pasado como elemento. */
  starHelp?: ReactNode;
}) {
  const uid = useId();
  const [answers, setAnswers] = useState<AnswerView[]>(initialAnswers);
  // Respuesta recién evaluada que todavía se está mirando: «Siguiente pregunta» la cierra
  const [reviewing, setReviewing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [pending, startTransition] = useTransition();
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const answered = answers.length;
  const done = answered >= TOTAL && !reviewing;
  const current = Math.min(reviewing ? answered : answered + 1, TOTAL);
  const questionIndex = reviewing ? answered - 1 : answered;
  const last = answers[answers.length - 1];

  function send(event: React.FormEvent) {
    event.preventDefault();
    submit();
  }

  function submit() {
    if (pending) return;
    setError(null);
    setErrorCode(null);
    startTransition(async () => {
      const result = await answerInterviewAction({ sessionId, answer: text });
      if (!result.ok) {
        setError(ANSWER_ERRORS[result.error] ?? ANSWER_ERRORS.server!);
        setErrorCode(result.error);
        return;
      }
      setAnswers((prev) => [
        ...prev,
        {
          position: result.position,
          answer: text,
          ...result.feedback,
        },
      ]);
      setTruncated(result.truncated);
      setText("");
      setReviewing(true);
    });
  }

  function next() {
    setReviewing(false);
    setTruncated(false);
    // Foco al campo de la pregunta siguiente
    requestAnimationFrame(() => fieldRef.current?.focus());
  }

  if (done) {
    const built = buildInterviewReport(answers);
    const report = built.ok ? built.value : null;
    const average = report ? report.overall : null;
    return (
      <div className="interview-report flex flex-col gap-5" data-testid="interview-summary">
        <section
          aria-labelledby={`${uid}-resumen`}
          className="rounded-card bg-ink p-5 text-on-ink sm:p-6"
        >
          <p className="text-sm font-bold text-brand">Simulación terminada</p>
          <h2 id={`${uid}-resumen`} className="mt-1 text-xl font-extrabold">
            {title}
          </h2>
          {average !== null ? (
            <p className="mt-3 text-on-ink-muted">
              Tu promedio en las cinco respuestas fue{" "}
              <strong className="text-on-ink">{formatAverage(average)} de 10</strong>. Es una guía
              para practicar, no una predicción de ninguna entrevista.
            </p>
          ) : null}
        </section>
        {report ? (
          <Suspense fallback={null}>
            <InterviewReportView report={report} questions={questions} starHelp={starHelp} />
          </Suspense>
        ) : null}
        <div className="no-print flex flex-wrap items-start gap-3">
          <Suspense fallback={null}>
            <RetryButton source={source} />
          </Suspense>
          <PrintButton label="Imprimir o guardar como PDF" />
          <Link href="/interview" className={buttonClasses({ variant: "secondary", size: "md" })}>
            Volver a Interview
          </Link>
        </div>
        <h2 className="text-lg font-extrabold text-fg">Respuesta por respuesta</h2>
        <ol className="flex flex-col gap-4">
          {answers.map((a) => (
            <Card
              as="li"
              key={a.position}
              level="list"
              padding="md"
              className="print-card flex flex-col gap-3"
            >
              <p className="text-[13px] font-extrabold text-fg-muted">
                Pregunta {a.position + 1} de {TOTAL}
              </p>
              <p className="text-base font-bold text-fg">{questions[a.position]}</p>
              <Scores item={a} starHelp={starHelp} />
              <p className="text-base text-fg">
                <span className="font-bold">Consejo: </span>
                {a.tip}
              </p>
            </Card>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby={`${uid}-pregunta`}
        className="rounded-card bg-ink p-5 text-on-ink sm:p-6"
        data-testid="interview-question-card"
      >
        <div className="flex items-center justify-between gap-3">
          <p
            id={`${uid}-pregunta`}
            className="text-sm font-extrabold text-brand"
            data-testid="interview-progress-label"
          >
            Pregunta {current} de {TOTAL}
          </p>
          <p className="truncate text-sm text-on-ink-muted">{title}</p>
        </div>
        <div
          role="progressbar"
          aria-label="Respuestas evaluadas"
          aria-valuemin={0}
          aria-valuemax={TOTAL}
          aria-valuenow={answered}
          className="mt-3 h-2 overflow-hidden rounded-pill bg-ink-line"
        >
          <div
            className="h-full rounded-pill bg-brand transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${(answered / TOTAL) * 100}%` }}
          />
        </div>
        <p className="mt-4 text-lg font-bold leading-snug" data-testid="interview-question">
          {questions[questionIndex]}
        </p>
      </section>

      {reviewing && last ? (
        <Card as="section" aria-label="Devolución de tu respuesta" level="featured" padding="md">
          <div className="flex flex-col gap-4">
            {truncated ? (
              <Alert tone="info" role="note">
                Tu respuesta era muy larga y evaluamos solo los primeros{" "}
                {INTERVIEW_ANSWER_MAX_CHARS} caracteres.
              </Alert>
            ) : null}
            <FeedbackCard item={last} starHelp={starHelp} />
            <Button
              type="button"
              size="md"
              className="self-start"
              onClick={next}
              data-testid="interview-next"
            >
              {answered >= TOTAL ? "Ver mi resumen" : "Siguiente pregunta"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card as="section" aria-label="Tu respuesta" padding="md">
          <form onSubmit={send} className="flex flex-col gap-3">
            <label htmlFor={`${uid}-respuesta`} className={labelClasses()}>
              Tu respuesta
            </label>
            <textarea
              id={`${uid}-respuesta`}
              ref={fieldRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              disabled={pending}
              placeholder="Contá una situación concreta: qué pasó, qué hiciste vos y cómo terminó."
              aria-describedby={`${uid}-ayuda`}
              className={inputClasses({ multiline: true })}
              data-testid="interview-answer"
            />
            <VoiceInput
              serverTranscribe={serverTranscribe}
              onText={(spoken) =>
                setText((prev) => joinDictated(prev, spoken).slice(0, INTERVIEW_ANSWER_MAX_CHARS))
              }
              disabled={pending}
            />
            <p id={`${uid}-ayuda`} className="text-xs text-fg-subtle">
              Hasta {INTERVIEW_ANSWER_MAX_CHARS} caracteres. No hace falta que incluyas datos
              personales: tus respuestas son solo para tu práctica.
            </p>
            {error ? (
              <Alert tone="danger" role="alert" data-testid="interview-answer-error">
                {error}
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="md" aria-disabled={pending} data-testid="interview-send">
                {pending ? "Evaluando tu respuesta…" : "Enviar respuesta"}
              </Button>
              {error && errorCode && RETRYABLE.has(errorCode) && !pending ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={submit}
                  data-testid="interview-answer-retry"
                >
                  {INTERVIEW_TEXTOS.retry}
                </Button>
              ) : null}
              <span role="status" className="text-sm text-fg-muted">
                {pending ? "Esto puede tardar unos segundos." : ""}
              </span>
            </div>
            {pending ? <AnswerSkeleton /> : null}
          </form>
        </Card>
      )}
    </div>
  );
}
