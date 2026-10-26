"use client";

import { SELF_LEVELS } from "@job-search-os/pipeline";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { saveSkillLevelFromJobAction } from "./skill-level-actions";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

const ERROR_TEXT: Record<string, string> = {
  level: "Elegí uno de los cuatro niveles.",
  slug: "Esta skill no se puede cargar desde acá. Cargala en Ajustes, en Skills.",
  jobId: "No se pudo guardar desde esta oferta. Recargá la página y probá de nuevo.",
};
const GENERIC_ERROR = "No se pudo guardar. Probá de nuevo; lo que elegiste sigue acá.";

/**
 * Si el botón que abrió el modal desaparece con el refresco (la skill ya tiene nivel), el foco cae
 * al `body`. Se lo lleva al contenido principal, sin mover el scroll. Vive fuera del componente: el
 * componente se desmonta junto con el botón.
 */
function recoverFocusAfterRefresh(): void {
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    if (document.activeElement === document.body) {
      document.getElementById("contenido")?.focus({ preventScroll: true });
      window.clearInterval(timer);
    } else if (tries >= 25) {
      window.clearInterval(timer);
    }
  }, 100);
}

/**
 * Botón «Cargar mi nivel de X» y su modal (C-20). `<dialog>` nativo: `showModal()` atrapa el foco,
 * Esc cierra y el foco vuelve al botón. Guarda solo ese nivel con `saveSkillLevelFromJobAction` y,
 * si sale bien, cierra y refresca la misma oferta (sin redirect). Si falla, el modal sigue abierto
 * con el mensaje y lo elegido no se pierde. La descripción es texto fijo de la taxonomía.
 */
export function SkillLevelButton({
  slug,
  name,
  description,
  jobId,
  className = "",
}: {
  slug: string;
  name: string;
  /** Frase de «¿Qué es?»; sin ella no se muestra el bloque. */
  description: string | null;
  jobId: string;
  /** Clases extra del botón que abre el modal. */
  className?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const titleId = `${uid}-titulo`;
  const errorId = `${uid}-error`;

  function reset() {
    setSelected(null);
    setError(null);
  }

  function save() {
    if (selected === null) {
      setError(ERROR_TEXT.level!);
      return;
    }
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof saveSkillLevelFromJobAction>>;
      try {
        result = await saveSkillLevelFromJobAction({ slug, level: selected, jobId });
      } catch {
        setError(GENERIC_ERROR);
        return;
      }
      if (!result.ok) {
        setError(ERROR_TEXT[result.field] ?? GENERIC_ERROR);
        return;
      }
      dialogRef.current?.close();
      router.refresh();
      recoverFocusAfterRefresh();
    });
  }

  return (
    <>
      <button
        type="button"
        data-testid={`skill-level-open-${slug}`}
        onClick={() => dialogRef.current?.showModal()}
        className={`inline-flex min-h-11 items-center rounded-md border border-zinc-400 px-3 py-2 text-left text-sm font-medium text-zinc-900 ${FOCUS_RING} ${className}`.trim()}
      >
        Cargar mi nivel de {name}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={reset}
        data-testid="skill-level-modal"
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-md p-4 text-sm backdrop:bg-black/50"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-col gap-3"
        >
          <h2 id={titleId} className="break-words text-base font-semibold">
            Tu nivel de {name}
          </h2>
          {description ? (
            <p className="break-words text-zinc-700">
              <span className="font-medium">¿Qué es? </span>
              {description}
            </p>
          ) : null}
          <fieldset className="flex flex-col gap-1" aria-describedby={error ? errorId : undefined}>
            <legend className="mb-1 font-medium">¿Cuánto lo usaste?</legend>
            {SELF_LEVELS.map((l) => (
              <label
                key={l.level}
                htmlFor={`${uid}-${l.level}`}
                className="flex min-h-11 items-center gap-2 rounded-md px-1 py-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-zinc-900"
              >
                <input
                  id={`${uid}-${l.level}`}
                  type="radio"
                  name={`${uid}-nivel`}
                  value={l.level}
                  checked={selected === l.level}
                  onChange={() => {
                    setSelected(l.level);
                    setError(null);
                  }}
                  aria-invalid={error ? true : undefined}
                  className="h-5 w-5"
                />
                {l.label}
              </label>
            ))}
          </fieldset>
          {error ? (
            <p id={errorId} role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-800">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={pending}
              className={`min-h-11 rounded-md border border-zinc-400 px-4 py-2 text-base ${FOCUS_RING}`}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white disabled:opacity-60 ${FOCUS_RING}`}
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
