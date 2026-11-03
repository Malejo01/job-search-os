"use client";

import { extractPastedJob, MAX_PASTE_CHARS, type PastedJobFields } from "@job-search-os/pipeline";
import { useEffect, useRef, useState } from "react";
import { alertClasses, buttonClasses, cardClasses, inputClasses } from "@/components/ui";
import { createManualJobAction } from "./actions";
import { JobFields } from "./job-fields";

// C9-11: el formulario va en una tarjeta blanca, con los campos y botones de las primitivas
const PANEL = cardClasses({ padding: "md", className: "flex flex-col gap-4" });

function filledCount(f: PastedJobFields): number {
  return [f.title, f.company, f.location, f.modality !== "desconocida" ? "x" : null].filter(
    (v) => v !== null,
  ).length;
}

/**
 * "Pegar el aviso entero" (ronda 63): paso 1, pegar y leer con reglas simples en el navegador;
 * paso 2, el mismo formulario del alta manual ya completado y editable. Guarda con la misma
 * Server Action. Nada de lo leído se guarda sin que la persona lo revise.
 */
export function PasteForm({ error }: { error?: string }) {
  const [text, setText] = useState("");
  const [fields, setFields] = useState<PastedJobFields | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cameBack = useRef(false);

  // Al pasar al paso 2, el foco va al primer obligatorio vacío o, si no, al aviso de estado; al
  // volver a pegar, al texto
  useEffect(() => {
    if (!fields) {
      if (cameBack.current) textRef.current?.focus();
      return;
    }
    const form = formRef.current;
    const target = !fields.title
      ? form?.elements.namedItem("title")
      : !fields.company
        ? form?.elements.namedItem("company")
        : statusRef.current;
    if (target instanceof HTMLElement) target.focus();
  }, [fields]);

  if (!fields) {
    return (
      <div className={PANEL}>
        <label className="flex flex-col gap-1.5 text-sm">
          Pegá el aviso completo (título, empresa, descripción…)
          <textarea
            ref={textRef}
            aria-describedby="pegar-ayuda"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            maxLength={MAX_PASTE_CHARS}
            className={inputClasses({ multiline: true })}
          />
        </label>
        <p id="pegar-ayuda" className="text-xs text-fg-subtle">
          Leemos el texto en tu navegador con reglas simples; revisá los datos antes de guardar.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            disabled={text.trim() === ""}
            aria-describedby="pegar-ayuda"
            onClick={() => setFields(extractPastedJob(text))}
            className={buttonClasses()}
          >
            Leer el aviso
          </button>
        </div>
      </div>
    );
  }

  const missing = [!fields.title ? "título" : null, !fields.company ? "empresa" : null].filter(
    (v): v is string => v !== null,
  );
  return (
    <form ref={formRef} action={createManualJobAction} className={PANEL}>
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className={alertClasses({ tone: missing.length > 0 ? "danger" : "warning" })}
      >
        Leímos el aviso. Completamos {filledCount(fields)} de 4 campos (título, empresa, ubicación y
        modalidad). Revisá los datos antes de guardar.
        {missing.length > 0
          ? ` Falta: ${missing.join(" y ")}, que ${missing.length > 1 ? "son obligatorios" : "es obligatorio"}.`
          : ""}
      </p>
      <JobFields
        error={error}
        defaults={fields}
        submitLabel="Guardar oferta"
        pendingLabel="Guardando…"
        secondaryAction={
          <button
            type="button"
            onClick={() => {
              cameBack.current = true;
              setFields(null);
            }}
            className={buttonClasses({ variant: "secondary" })}
          >
            Volver a pegar
          </button>
        }
      />
    </form>
  );
}
