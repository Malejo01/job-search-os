"use client";

import { useState, useTransition } from "react";
import { humanNoteAction } from "./actions";

const MAX = 140;

const CHIPS = [
  "no es mi rol",
  "el score está alto",
  "el score está bajo",
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
    startTransition(async () => {
      await humanNoteAction(fd);
      setDone(true);
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
      <p className="text-xs font-medium text-zinc-700">¿Por qué? (opcional)</p>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setDone(false);
              setText((t) => addReason(t, chip));
            }}
            className="min-h-[36px] rounded-full border border-zinc-300 bg-white px-3 text-xs text-zinc-800 hover:border-zinc-500"
          >
            {chip}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-zinc-600">
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
            className="rounded-md border border-zinc-300 px-2 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={pending || trimmed === "" || trimmed === saved}
          className="min-h-[44px] rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar motivo"}
        </button>
        {saved !== "" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => save("")}
            className="min-h-[44px] rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-800 disabled:opacity-50"
          >
            Quitar motivo
          </button>
        ) : null}
      </div>
      <p role="status" className="min-h-[1rem] text-xs text-green-700">
        {done && !pending ? "Guardado ✓" : ""}
      </p>
    </form>
  );
}
