"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { answerRequirementAction } from "@/app/(app)/jobs/[id]/requirement-answer-actions";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const BUTTON = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line-control px-4 py-2 text-sm font-medium text-fg disabled:cursor-wait ${FOCUS_RING}`;

type Valor = "si" | "no" | "en_parte";

/** Los textos viajan por props: el componente es chico y no arrastra el archivo de textos al cliente. */
export type PreguntaUnToqueTextos = {
  enunciado: string;
  grupo: string; // con {pide}
  si: string;
  no: string;
  enParte: string;
  notaEtiqueta: string;
  guardar: string;
  guardando: string;
  ayuda: string;
  respondida: string; // con {valor}
  cambiar: string;
  error: string;
  errorNota: string;
};

/**
 * La pregunta de un toque de una fila «Sin confirmar» de lo que pide el aviso (R31-05): «Sí», «No» o «En
 * parte». «Sí» y «No» guardan al tocar; «En parte» abre una nota opcional. La respuesta vale para las demás
 * ofertas que pidan lo mismo (la clave la arma el código). Al guardar, la página se refresca y el estado de la
 * fila lo decide el código: acá no se calcula nada. Con una respuesta ya dada muestra solo qué contestó y un
 * botón para cambiarla.
 */
export function PreguntaUnToque({
  jobId,
  clave,
  pide,
  respuesta,
  nota,
  textos,
}: {
  jobId: string;
  clave: string;
  pide: string;
  respuesta: Valor | null;
  nota: string | null;
  textos: PreguntaUnToqueTextos;
}) {
  const router = useRouter();
  const uid = useId();
  const [editing, setEditing] = useState(respuesta === null);
  const [askNote, setAskNote] = useState(false);
  const [text, setText] = useState(nota ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label: Record<Valor, string> = { si: textos.si, no: textos.no, en_parte: textos.enParte };

  function send(valor: Valor) {
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof answerRequirementAction>>;
      try {
        result = await answerRequirementAction({
          jobId,
          clave,
          valor,
          nota: valor === "en_parte" ? text : null,
        });
      } catch {
        setError(textos.error);
        return;
      }
      if (!result.ok) {
        setError(result.field === "nota" ? textos.errorNota : textos.error);
        return;
      }
      setEditing(false);
      setAskNote(false);
      router.refresh();
    });
  }

  if (!editing && respuesta) {
    return (
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1"
        data-testid="pregunta-respondida"
      >
        <p className="text-xs text-fg-muted">
          {textos.respondida.replace("{valor}", label[respuesta])}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`min-h-11 text-sm font-semibold text-link underline underline-offset-2 ${FOCUS_RING}`}
        >
          {textos.cambiar}
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={textos.grupo.replace("{pide}", pide)}
      className="flex flex-col gap-2 pt-1"
      data-testid="pregunta-un-toque"
    >
      <p className="text-xs font-bold text-fg">{textos.enunciado}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => send("si")} className={BUTTON}>
          {textos.si}
        </button>
        <button type="button" disabled={pending} onClick={() => send("no")} className={BUTTON}>
          {textos.no}
        </button>
        <button
          type="button"
          disabled={pending}
          aria-expanded={askNote}
          aria-controls={`${uid}-nota`}
          onClick={() => setAskNote((v) => !v)}
          className={BUTTON}
        >
          {textos.enParte}
        </button>
      </div>
      {askNote ? (
        <div id={`${uid}-nota`} className="flex flex-col gap-2">
          <label htmlFor={`${uid}-texto`} className="text-xs text-fg-muted">
            {textos.notaEtiqueta}
          </label>
          <textarea
            id={`${uid}-texto`}
            value={text}
            maxLength={200}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={error ? `${uid}-error` : undefined}
            className={`w-full rounded-control border border-line-control bg-surface p-2 text-sm text-fg ${FOCUS_RING}`}
          />
          <div>
            <button
              type="button"
              disabled={pending}
              onClick={() => send("en_parte")}
              className={BUTTON}
            >
              {pending ? textos.guardando : textos.guardar}
            </button>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-fg-subtle">{textos.ayuda}</p>
      {error ? (
        <p id={`${uid}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
