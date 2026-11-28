"use client";

import { useId, useState, useTransition } from "react";
import type { CvTailorOutput } from "@job-search-os/pipeline";
import { Alert, Button, Card } from "@/components/ui";
import { tailorCvAction, type TailorCvActionResult } from "@/lib/cv-tailor/actions";
import { POSTULACION_TEXTOS } from "@/lib/textos-rediseno";
import {
  TAILOR_BUTTON,
  TAILOR_BUTTON_PENDING,
  TAILOR_CHANGES_TITLE,
  TAILOR_ERRORS,
  TAILOR_INTRO,
  TAILOR_LIMIT_NOTE,
  TAILOR_UNCHANGED,
  TAILOR_VERIFIED_NOTE,
} from "./copy";
import { TailorSuggestions } from "./tailor-suggestions";

/**
 * Panel de la versión del CV adaptada con IA (R20-04). Client Component porque llama a la acción del servidor y
 * muestra el resultado; no guarda nada en el navegador y todo lo que muestra va como texto, nunca como HTML.
 *
 * Se monta solo si `cvTailorAllowedFor(userId)` dio true (la acción lo vuelve a comprobar). `onResult` avisa la
 * propuesta ya verificada (o `null` si no hay versión adaptada: error o todavía sin pedir) para que quien lo
 * monta la mande a la descarga; el servidor la vuelve a verificar, así que no hace falta confiar en el cliente.
 */
export function CvTailorPanel({
  jobId,
  onResult,
}: {
  jobId: string;
  onResult?: (proposal: CvTailorOutput | null) => void;
}) {
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TailorCvActionResult | null>(null);

  function ask() {
    if (pending) return;
    onResult?.(null);
    startTransition(async () => {
      const r = await tailorCvAction({ jobId });
      setResult(r);
      onResult?.(r.ok && r.changed ? r.proposal : null);
    });
  }

  return (
    <Card
      as="section"
      aria-labelledby={`${uid}-titulo`}
      level="list"
      padding="md"
      data-testid="cv-tailor"
    >
      <div className="flex flex-col gap-3">
        <h2 id={`${uid}-titulo`} className="text-lg font-extrabold">
          {POSTULACION_TEXTOS.adaptar.titulo}
        </h2>
        <p className="text-base">{TAILOR_INTRO}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={pending}
            onClick={ask}
            data-testid="cv-tailor-button"
          >
            {pending ? TAILOR_BUTTON_PENDING : TAILOR_BUTTON}
          </Button>
          <p className="text-sm text-fg-muted">{TAILOR_LIMIT_NOTE}</p>
        </div>

        <div aria-live="polite" className="flex flex-col gap-3">
          {result && !result.ok ? (
            <Alert tone="warning" role="note" data-testid="cv-tailor-error">
              {TAILOR_ERRORS[result.error] ?? TAILOR_ERRORS.server!}
            </Alert>
          ) : null}

          {result?.ok ? (
            <div className="flex flex-col gap-4" data-testid="cv-tailor-result">
              <Alert tone="success" role="status">
                {result.changed ? TAILOR_VERIFIED_NOTE : TAILOR_UNCHANGED}
              </Alert>

              {result.changed && result.changes.length > 0 ? (
                <section aria-labelledby={`${uid}-cambios`} className="flex flex-col gap-2">
                  <h3 id={`${uid}-cambios`} className="text-base font-extrabold">
                    {TAILOR_CHANGES_TITLE}
                  </h3>
                  <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base">
                    {result.changes.map((c) => (
                      <li key={`${c.what}|${c.why}`}>
                        <span className="font-semibold">{c.what}</span> {c.why}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {result.changed && result.suggestions.length > 0 ? (
                <TailorSuggestions
                  // Una propuesta nueva empieza sin decisiones
                  key={JSON.stringify(result.proposal)}
                  jobId={jobId}
                  proposal={result.proposal}
                  suggestions={result.suggestions}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
