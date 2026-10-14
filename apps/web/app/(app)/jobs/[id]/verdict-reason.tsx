"use client";

import { useState } from "react";
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
  return (
    <form action={humanNoteAction} className="flex flex-col gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <p className="text-xs font-medium text-zinc-700">¿Por qué? (opcional)</p>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => setText((t) => addReason(t, chip))}
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
            onChange={(e) => setText(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-2 text-base"
          />
        </label>
        <button
          type="submit"
          className="min-h-[44px] rounded-md bg-zinc-900 px-3 text-sm font-medium text-white"
        >
          Guardar motivo
        </button>
      </div>
    </form>
  );
}
