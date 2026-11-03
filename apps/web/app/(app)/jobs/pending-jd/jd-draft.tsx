"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";

const LAST = "jso-borrador-jd-ultimo";
const keyOf = (jobId: string) => `jso-borrador-jd:${jobId}`;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Sin sessionStorage (modo privado, bloqueado): no hay borrador, el resto anda igual
  }
}

/**
 * F2 (C9-13, decisión 12): la descripción pegada no se pierde si el guardado falla. La acción del
 * servidor redirige con `?error=…` (no se toca: es carril rojo) y la página vuelve con el campo
 * vacío; este componente guarda el borrador en `sessionStorage` mientras se escribe y, si vuelve
 * con error para esta oferta, lo devuelve al campo, muestra el aviso ahí mismo y pone el foco.
 * Con el guardado bien hecho (`saved`), borra el borrador. Va dentro del `<form>`.
 */
/**
 * Después de guardar bien (`?ok=`), la oferta sale de la lista y su `JdDraft` ya no se monta: este
 * componente, que va siempre en la página, borra el borrador de la última enviada (R-3).
 */
export function JdDraftsReset({ saved }: { saved: boolean }) {
  useEffect(() => {
    if (!saved) return;
    const last = read(LAST);
    if (last) write(keyOf(last), null);
    write(LAST, null);
  }, [saved]);
  return null;
}

export function JdDraft({
  jobId,
  textareaId,
  error,
  saved,
}: {
  jobId: string;
  textareaId: string;
  /** Motivo del error de la última vez, si la página volvió con uno. */
  error: string | null;
  saved: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const field = document.getElementById(textareaId) as HTMLTextAreaElement | null;
    if (!field) return;
    if (saved) {
      write(keyOf(jobId), null);
      return;
    }
    // Volvió con error para esta oferta: el texto vuelve al campo (el contador se entera por el
    // evento `input`, con el setter nativo para que React lo vea)
    const draft = read(keyOf(jobId));
    if (error && read(LAST) === jobId && draft && !field.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, draft);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      // Fuera del efecto (en el próximo turno): el aviso no fuerza un render en cascada
      window.setTimeout(() => setNotice(error), 0);
      field.focus();
    }
    const onInput = () => write(keyOf(jobId), field.value);
    const onSubmit = () => {
      write(keyOf(jobId), field.value);
      write(LAST, jobId);
    };
    const form = field.form;
    field.addEventListener("input", onInput);
    form?.addEventListener("submit", onSubmit);
    return () => {
      field.removeEventListener("input", onInput);
      form?.removeEventListener("submit", onSubmit);
    };
  }, [error, jobId, saved, textareaId]);

  if (!notice) return null;
  return (
    <Alert tone="danger" role="status" data-testid="jd-error-en-lugar">
      <p>No pudimos guardar la descripción. {notice} Tu texto sigue acá.</p>
    </Alert>
  );
}
