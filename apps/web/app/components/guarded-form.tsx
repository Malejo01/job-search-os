"use client";

import { unstable_rethrow } from "next/navigation";
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";

/** Lo que devuelve una acción cuando la validación o un conflicto impiden guardar (ronda 77). */
export type FormActionError = { ok: false; field: string };

const GENERIC_FIELD = "_error";
const GENERIC_MESSAGE =
  "No se pudo guardar. Probá de nuevo; lo que cargaste sigue en el formulario.";

type Ctx = { pending: boolean; field: string | null; message: string; prefix: string };
const FormCtx = createContext<Ctx>({ pending: false, field: null, message: "", prefix: "" });

/**
 * Formulario que no pierde lo cargado cuando la acción rechaza el guardado. Se envía con `onSubmit`
 * + `preventDefault` y llama a la acción en una transición: no hay `redirect` en el error ni el reset
 * de React 19 que vacía el formulario al terminar una `<form action>` (ver verdict-reason.tsx).
 * Si la acción sale bien, ella misma redirige. Ante `{ ok: false, field }`: resumen arriba con
 * `role="alert"`, mensaje junto al campo (`FieldError`), `aria-invalid` + `aria-describedby` en el
 * campo y foco en él. Los campos no se tocan.
 */
export function GuardedForm({
  action,
  messages,
  fallback = "Revisá los datos del formulario.",
  groups = {},
  conflictField,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<FormActionError | void>;
  /** Mensaje por `field`. Si no hay uno exacto se prueba con lo que va antes de los `:`. */
  messages: Record<string, string>;
  fallback?: string;
  /** Errores que apuntan a varios campos (p. ej. `thresholds` → los tres umbrales). */
  groups?: Record<string, string[]>;
  /** Error que obliga a recargar (versión vieja): el resumen suma el botón «Recargar». */
  conflictField?: string;
  className?: string;
  children: ReactNode;
}) {
  const prefix = useId();
  const [pending, startTransition] = useTransition();
  const [field, setField] = useState<string | null>(null);
  const marked = useRef<HTMLElement[]>([]);
  // aria-describedby que tenía cada campo antes del error, para restaurarlo
  const previous$ = useRef(new Map<HTMLElement, string | null>()).current;

  function clearMarks() {
    for (const node of marked.current) {
      node.removeAttribute("aria-invalid");
      const previous = previous$.get(node);
      if (previous) node.setAttribute("aria-describedby", previous);
      else node.removeAttribute("aria-describedby");
    }
    marked.current = [];
    previous$.clear();
  }

  function showError(form: HTMLFormElement, failed: string) {
    const nodes: HTMLElement[] = [];
    for (const name of groups[failed] ?? [failed]) {
      const found = form.elements.namedItem(name);
      if (found === null) continue;
      const list = found instanceof RadioNodeList ? Array.from(found) : [found];
      for (const node of list) if (node instanceof HTMLElement) nodes.push(node);
    }
    const errorId = `${prefix}-${failed}`;
    for (const node of nodes) {
      const previous = node.getAttribute("aria-describedby");
      previous$.set(node, previous);
      node.setAttribute("aria-invalid", "true");
      node.setAttribute("aria-describedby", previous ? `${previous} ${errorId}` : errorId);
    }
    marked.current = nodes;
    const target = nodes.find((n) => !(n as HTMLInputElement).disabled);
    target?.focus();
    setField(failed);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    // El botón que envió (p. ej. «Saltear por ahora» o «Quitar») viaja con su name/value
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(form, submitter);
    clearMarks();
    setField(null);
    startTransition(async () => {
      try {
        const result = await action(data);
        if (result && !result.ok) showError(form, result.field);
      } catch (error) {
        // El redirect de éxito rechaza la promesa en Next 15: no es un fallo
        unstable_rethrow(error);
        setField(GENERIC_FIELD);
      }
    });
  }

  const message =
    field === null
      ? ""
      : field === GENERIC_FIELD
        ? GENERIC_MESSAGE
        : (messages[field] ?? messages[field.split(":")[0] ?? ""] ?? fallback);

  return (
    <FormCtx.Provider value={{ pending, field, message, prefix }}>
      <form onSubmit={onSubmit} className={className}>
        {field !== null ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            <span>{message}</span>
            {field === conflictField ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-11 rounded-control border border-danger-line bg-surface px-3 py-1 text-sm text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                Recargar
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

/** Mensaje junto al campo `name`: aparece solo cuando el error de la acción apunta a él. */
export function FieldError({ name }: { name: string }) {
  const { field, message, prefix } = useContext(FormCtx);
  if (field !== name) return null;
  return (
    <span id={`${prefix}-${name}`} className="text-xs font-medium text-danger">
      {message}
    </span>
  );
}

/** Botón de envío para `GuardedForm`: `useFormStatus` no ve estos envíos, usa el estado de la transición. */
export function PendingSubmit({
  children,
  pendingLabel = "Guardando…",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useContext(FormCtx);
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`.trim()}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
