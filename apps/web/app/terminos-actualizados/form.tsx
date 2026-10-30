"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { acceptTermsAction } from "./actions";

/**
 * Casilla y botón de la re-aceptación. noValidate: la validación es del servidor y el error aparece
 * junto al campo sin perder lo marcado. El redirect de la acción lo resuelve Next.
 */
export function AcceptTermsForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const checkboxRef = useRef<HTMLInputElement>(null);

  // Con el error a la vista el foco vuelve a la casilla
  useEffect(() => {
    if (error) checkboxRef.current?.focus();
  }, [error]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await acceptTermsAction(data);
        setError(result?.error ?? null);
      } catch (e) {
        unstable_rethrow(e);
        setError("No se pudo guardar. Probá de nuevo.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            ref={checkboxRef}
            name="terminos"
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "terminos-error" : undefined}
            className="h-5 w-5 shrink-0"
          />
          Leí y acepto los términos y la política de privacidad
        </label>
        {error ? (
          <p id="terminos-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast disabled:opacity-60"
      >
        {pending ? "Guardando…" : "Aceptar y seguir"}
      </button>
    </form>
  );
}
