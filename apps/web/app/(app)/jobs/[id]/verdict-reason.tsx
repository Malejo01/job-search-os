"use client";

import { useState, useTransition } from "react";
import { humanNoteAction } from "./actions";

const MAX = 140;

const CHIPS = [
  "no es mi puesto",
  "el puntaje está alto",
  "el puntaje está bajo",
  "ubicación o modalidad",
  "sueldo",
  "le faltó leer algo del aviso",
];

/** Suma el motivo al texto separado por "; ", sin repetir y sin pasar de MAX. */
function addReason(text: string, reason: string): string {
  const parts = text
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.includes(reason)) return text;
  const next = [...parts, reason].join("; ");
  return next.length > MAX ? text : next;
}

/** "¿Por qué? (opcional)": chips que completan el motivo corto, que se guarda en human_note. */
export function VerdictReason({
  jobId,
  evaluationId,
  note,
}: {
  jobId: string;
  evaluationId: string;
  note: string | null;
}) {
  const [text, setText] = useState(note ?? "");
  const [seenNote, setSeenNote] = useState(note);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  // Si la nota cambia desde afuera (otro formulario o la revalidación tras guardar), el campo la
  // muestra. Se sincroniza en el render y no con una key para no perder el "Guardado ✓".
  if (note !== seenNote) {
    setSeenNote(note);
    setText(note ?? "");
  }

  const saved = note ?? "";
  const trimmed = text.trim();

  // onSubmit con preventDefault: <form action> resetea el formulario al terminar la action (React 19)
  // y el campo quedaba vacío aunque el motivo sí se hubiera guardado.
  function save(value: string) {
    const fd = new FormData();
    fd.set("jobId", jobId);
    fd.set("evaluationId", evaluationId);
    fd.set("humanNote", value);
    setDone(false);
    setFailed(false);
    startTransition(async () => {
      try {
        await humanNoteAction(fd);
        setDone(true);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || trimmed === "" || trimmed === saved) return;
        save(trimmed);
      }}
      className="flex flex-col gap-2"
    >
      <p className="text-xs font-medium text-fg-muted">¿Por qué? (opcional)</p>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setDone(false);
              setText((t) => addReason(t, chip));
            }}
            className="min-h-11 rounded-pill border border-fg-subtle bg-surface px-3 text-xs text-fg hover:border-fg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {chip}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-fg-subtle">
          Motivo
          <input
            name="humanNote"
            type="text"
            maxLength={MAX}
            value={text}
            readOnly={pending}
            onChange={(e) => {
              setDone(false);
              setText(e.target.value);
            }}
            className="rounded-control border border-fg-subtle px-2 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending || trimmed === "" || trimmed === saved}
          className="min-h-[44px] rounded-control bg-brand px-3 text-sm font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar motivo"}
        </button>
        {saved !== "" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => save("")}
            className="min-h-[44px] rounded-control border border-fg-subtle bg-surface px-3 text-sm text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            Quitar motivo
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="min-h-[1rem] text-xs text-success">
        {done && !pending && !failed ? "Guardado ✓" : ""}
      </p>
      <p aria-live="polite" className="min-h-[1rem] text-xs text-danger">
        {failed && !pending ? "No se pudo guardar el motivo. Probá de nuevo." : ""}
      </p>
    </form>
  );
}
