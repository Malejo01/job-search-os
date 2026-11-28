"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { buttonClasses } from "@/components/ui/button";
import { saveProfileFieldFromJobAction } from "./repetido-actions";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export type RepetidoField = "ingles" | "anos" | "pais";

/** Los textos viajan como props: el cliente no importa el archivo grande de textos. */
export type RepetidoTextos = {
  /** «Esto mismo te pasa en N de tus M ofertas», ya completado. */
  frase: string;
  /** «Actualizar mi inglés», ya completado. */
  boton: string;
  modalTitulo: string;
  modalAyuda: string;
  etiqueta: string;
  guardar: string;
  guardando: string;
  cancelar: string;
  error: string;
  errorValor: string;
  /** Solo para inglés. */
  inglesElegir: string;
  inglesOpciones: readonly { value: string; label: string }[];
};

/**
 * «Esto mismo te pasa en N de tus M ofertas» con un botón que abre SOLO ese campo (R31-08), en un
 * `<dialog>` nativo (foco atrapado, Esc cierra, el foco vuelve al botón). Guarda ese único dato con
 * `saveProfileFieldFromJobAction` y refresca: las ofertas afectadas se recalculan por código, sin
 * modelo. Si falla, el modal sigue abierto y lo escrito no se pierde.
 */
export function RepetidoCampo({
  field,
  jobId,
  textos,
}: {
  field: RepetidoField;
  jobId: string;
  textos: RepetidoTextos;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const titleId = `${uid}-titulo`;
  const errorId = `${uid}-error`;
  const inputId = `${uid}-campo`;

  function save() {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof saveProfileFieldFromJobAction>>;
      try {
        result = await saveProfileFieldFromJobAction({ field, value, jobId });
      } catch {
        setError(textos.error);
        return;
      }
      if (!result.ok) {
        setError(result.field === "value" ? textos.errorValor : textos.error);
        return;
      }
      dialogRef.current?.close();
      document.getElementById("contenido")?.focus({ preventScroll: true });
      router.refresh();
    });
  }

  return (
    <div
      data-testid="repetido"
      data-campo={field}
      className="flex min-w-0 flex-col gap-1 rounded-control bg-surface-muted p-3 text-sm"
    >
      <p data-testid="repetido-frase" className="font-semibold">
        {textos.frase}
      </p>
      <button
        type="button"
        data-testid="repetido-abrir"
        onClick={() => dialogRef.current?.showModal()}
        className={`inline-flex min-h-11 w-fit items-center rounded-control border border-line-control px-3 py-2 text-left text-sm font-medium text-fg ${FOCUS_RING}`}
      >
        {textos.boton}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => {
          setValue("");
          setError(null);
        }}
        data-testid="repetido-modal"
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-card bg-surface p-4 text-sm text-fg backdrop:bg-black/50"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-col gap-3"
        >
          <h2 id={titleId} className="break-words text-base font-semibold">
            {textos.modalTitulo}
          </h2>
          <p className="break-words text-fg-muted">{textos.modalAyuda}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className="font-medium">
              {textos.etiqueta}
            </label>
            {field === "ingles" ? (
              <select
                id={inputId}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                className={`min-h-11 rounded-control border border-line-control bg-surface px-2 ${FOCUS_RING}`}
              >
                <option value="">{textos.inglesElegir}</option>
                {textos.inglesOpciones.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={inputId}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode={field === "anos" ? "decimal" : "text"}
                maxLength={field === "anos" ? 4 : 2}
                autoComplete="off"
                aria-describedby={error ? errorId : undefined}
                aria-invalid={error ? true : undefined}
                className={`min-h-11 rounded-control border border-line-control bg-surface px-2 ${FOCUS_RING}`}
              />
            )}
          </div>
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="rounded-control bg-danger-soft px-3 py-2 text-danger"
            >
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={pending}
              className={`min-h-11 rounded-control border border-line-control px-4 py-2 text-base ${FOCUS_RING}`}
            >
              {textos.cancelar}
            </button>
            <button type="submit" disabled={pending} className={buttonClasses()}>
              {pending ? textos.guardando : textos.guardar}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
