"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { startInterviewAction } from "../actions";
import { START_ERRORS } from "../copy";

export type RetrySource =
  { kind: "job"; jobId: string } | { kind: "career"; career: string; seniority: string };

/**
 * «Practicar de nuevo»: empieza otra simulación con la misma oferta (o carrera y nivel). Cuenta contra el tope
 * diario como cualquier simulación; si no quedan, avisa con el mensaje de siempre.
 */
export function RetryButton({ source }: { source: RetrySource }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function retry() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await startInterviewAction(source);
      if (result.ok) {
        router.push(`/interview/${result.sessionId}`);
        return;
      }
      setError(START_ERRORS[result.error] ?? START_ERRORS.server!);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="md"
        className="self-start"
        onClick={retry}
        aria-disabled={pending}
        data-testid="interview-retry"
      >
        {pending
          ? "Armando tus preguntas…"
          : source.kind === "job"
            ? "Practicar de nuevo con esta oferta"
            : "Practicar de nuevo con esta carrera"}
      </Button>
      {error ? (
        <Alert tone="danger" role="alert" data-testid="interview-retry-error">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
