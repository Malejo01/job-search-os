"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, inputClasses, labelClasses } from "@/components/ui";
import { startInterviewAction } from "./actions";
import { SENIORITY_OPTIONS, START_ERRORS } from "./copy";

type Source = "job" | "career";

/**
 * Elegir sobre qué practicar: una oferta guardada o una carrera con su nivel. Client Component porque
 * alterna campos y llama a la acción del servidor; no guarda nada en el navegador.
 */
export function StartForm({
  offers,
  suggestedCareer,
  left,
}: {
  offers: { id: string; title: string; company: string }[];
  suggestedCareer: string;
  left: number;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [source, setSource] = useState<Source>(offers.length > 0 ? "job" : "career");
  const [jobId, setJobId] = useState(offers[0]?.id ?? "");
  const [career, setCareer] = useState(suggestedCareer);
  const [seniority, setSeniority] = useState("junior");
  const [error, setError] = useState<string | null>(null);
  const blocked = left <= 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || blocked) return;
    setError(null);
    startTransition(async () => {
      const result = await startInterviewAction(
        source === "job" ? { kind: "job", jobId } : { kind: "career", career, seniority },
      );
      if (result.ok) {
        router.push(`/interview/${result.sessionId}`);
        return;
      }
      setError(START_ERRORS[result.error] ?? START_ERRORS.server!);
    });
  }

  const canSubmit = source === "job" ? jobId !== "" : career.trim() !== "";

  return (
    <Card as="section" aria-labelledby={`${uid}-titulo`} level="featured" padding="md">
      <form onSubmit={submit} className="flex flex-col gap-4" data-testid="interview-start">
        <h2 id={`${uid}-titulo`} className="text-lg font-extrabold">
          Elegí sobre qué practicar
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className={labelClasses({ className: "mb-1" })}>Punto de partida</legend>
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input
              type="radio"
              name={`${uid}-source`}
              checked={source === "job"}
              disabled={offers.length === 0}
              onChange={() => setSource("job")}
              className="size-5 accent-[var(--jso-brand-text)]"
            />
            Una oferta que tengas
          </label>
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input
              type="radio"
              name={`${uid}-source`}
              checked={source === "career"}
              onChange={() => setSource("career")}
              className="size-5 accent-[var(--jso-brand-text)]"
            />
            Una carrera y un nivel
          </label>
        </fieldset>

        {source === "job" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-job`} className={labelClasses()}>
              Oferta
            </label>
            <select
              id={`${uid}-job`}
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className={inputClasses()}
            >
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} · {o.company}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-career`} className={labelClasses()}>
                Carrera o puesto
              </label>
              <input
                id={`${uid}-career`}
                value={career}
                maxLength={120}
                onChange={(e) => setCareer(e.target.value)}
                placeholder="Por ejemplo, Analista de datos"
                className={inputClasses()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-seniority`} className={labelClasses()}>
                Nivel
              </label>
              <select
                id={`${uid}-seniority`}
                value={seniority}
                onChange={(e) => setSeniority(e.target.value)}
                className={inputClasses()}
              >
                {SENIORITY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {error ? (
          <Alert tone="danger" role="alert" data-testid="interview-start-error">
            {error}
          </Alert>
        ) : null}
        {blocked && !error ? (
          <Alert tone="info" role="note">
            {START_ERRORS.daily_limit}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            size="md"
            aria-disabled={pending || blocked || !canSubmit}
            data-testid="interview-start-button"
          >
            {pending ? "Armando tus preguntas…" : "Empezar simulación"}
          </Button>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {blocked
              ? "Hoy no te quedan simulaciones."
              : left === 1
                ? "Te queda 1 simulación en las próximas 24 horas."
                : `Te quedan ${left} simulaciones en las próximas 24 horas.`}
          </p>
        </div>
      </form>
    </Card>
  );
}
