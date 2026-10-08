"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { bulkInboxAction, undoBulkAction, type BulkKind } from "./actions";
import { UndoNotice } from "./undo-notice";

/**
 * Atributo de las casillas de cada fila (las renderiza el Server Component de la lista, que
 * escribe el mismo literal: una constante exportada desde un módulo "use client" no llega como
 * string al servidor).
 */
const SELECT_ATTR = "data-inbox-select";

type Vista = "pendientes" | "vistos" | "descartados" | "todos";

/** Botones por pestaña. Las posiciones no cambian mientras se está en la pestaña ni al seleccionar. */
const ACTIONS: Record<Vista, BulkKind[]> = {
  pendientes: ["seen", "dismiss", "delete"],
  vistos: ["restore_pending", "dismiss", "delete"],
  descartados: ["restore_seen", "restore_pending", "delete"],
  todos: ["seen", "dismiss", "restore_pending", "delete"],
};

const LABEL: Record<BulkKind, string> = {
  seen: "Marcar visto",
  dismiss: "No me sirve",
  restore_seen: "Volver a vistos",
  restore_pending: "Volver a pendientes",
  delete: "Eliminar",
};

const DONE: Record<Exclude<BulkKind, "delete">, string> = {
  seen: "marcados como vistos",
  dismiss: "descartados",
  restore_seen: "vueltos a vistos",
  restore_pending: "vueltos a pendientes",
};

const boxes = () =>
  [...document.querySelectorAll<HTMLInputElement>(`input[${SELECT_ATTR}]`)].filter(
    (b) => !b.disabled,
  );
/** Ids de los emails tildados en este momento (se lee del DOM, no de una posición guardada). */
const checkedIds = () =>
  new Set(
    boxes()
      .filter((b) => b.checked)
      .map((b) => b.value),
  );

const button =
  "h-8 w-full rounded border px-2 text-center text-xs disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Selección múltiple en /inbox (JS-049). Las casillas de las filas son inputs sin estado de
 * React; la selección es el conjunto de ids de email que tienen tilde, y se vuelve a leer del DOM
 * al apretar un botón. La acción viaja con su nombre (`kind`) y esa lista de ids, nunca con una
 * posición: así un cambio de ancho de ventana no puede mandar una acción sobre otra fila ni otra
 * acción. El espacio de la barra está reservado y los botones tienen tamaño fijo, para que no se
 * reacomoden bajo el puntero al seleccionar. Después de cualquier acción menos «Eliminar» aparece
 * «Deshacer» por 10 s. «Eliminar» pide una sola confirmación con la cantidad.
 */
export function BulkBar({ total, shown, view }: { total: number; shown: number; view: Vista }) {
  const router = useRouter();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{
    key: number;
    message: string;
    previous: Awaited<ReturnType<typeof bulkInboxAction>>["previous"];
  } | null>(null);

  const read = useCallback(() => setIds(checkedIds()), []);

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e.target as HTMLElement).hasAttribute?.(SELECT_ATTR)) read();
    };
    // Al montar no hay nada tildado: la selección arranca vacía y se lee en cada cambio
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [read]);

  const all = shown > 0 && ids.size === shown;
  const toggleAll = (checked: boolean) => {
    for (const b of boxes()) b.checked = checked;
    read();
  };

  const run = (kind: BulkKind) => {
    const chosen = [...checkedIds()];
    const n = chosen.length;
    if (!n) return;
    if (
      kind === "delete" &&
      !window.confirm(
        `¿Eliminar ${n} ${n === 1 ? "email" : "emails"}? Se borran de la base y no se puede deshacer.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await bulkInboxAction(kind, chosen);
      toggleAll(false);
      setNotice(
        kind === "delete" || res.n === 0
          ? null
          : {
              key: Date.now(),
              message:
                kind === "restore_pending" && res.stay > 0
                  ? `${res.n - res.stay} ${res.n - res.stay === 1 ? "vuelve" : "vuelven"} a la bandeja; ${res.stay} ${res.stay === 1 ? "ya tiene" : "ya tienen"} avisos cargados y ${res.stay === 1 ? "queda" : "quedan"} en Todos.`
                  : `${res.n} ${res.n === 1 ? "email" : "emails"} ${DONE[kind]}.`,
              previous: res.previous,
            },
      );
      router.refresh();
    });
  };

  const undo = () => {
    const previous = notice?.previous;
    if (!previous?.length) return;
    startTransition(async () => {
      await undoBulkAction(previous);
      setNotice(null);
      router.refresh();
    });
  };
  const expire = useCallback(() => setNotice(null), []);

  if (shown === 0 && !notice) return null;
  return (
    <div className="flex flex-col gap-2">
      {shown > 0 ? (
        <label className="flex items-center gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => toggleAll(e.target.checked)}
            aria-label="Seleccionar todos"
            className="h-4 w-4"
          />
          Seleccionar todos
          {total > shown
            ? ` (se ven ${shown} de ${total}; los demás aparecen al limpiar estos)`
            : ""}
        </label>
      ) : null}
      {/* Espacio reservado: la barra aparece sin empujar las filas ni mover los botones */}
      <div className="min-h-[7.5rem] sm:min-h-[5rem]">
        {ids.size > 0 ? (
          <div
            role="toolbar"
            aria-label="Acciones en lote"
            className={`sticky top-2 z-20 flex flex-col gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs shadow-sm ${
              pending ? "opacity-60" : ""
            }`}
          >
            <div className="flex h-5 items-center justify-between gap-2">
              <span className="font-medium text-zinc-800">
                {ids.size} {ids.size === 1 ? "seleccionado" : "seleccionados"}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => toggleAll(false)}
                className="text-zinc-500 underline"
              >
                Cancelar selección
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTIONS[view].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={pending}
                  onClick={() => run(kind)}
                  title={kind === "dismiss" ? "Estas fuentes no me sirven" : undefined}
                  className={`${button} ${
                    kind === "delete"
                      ? "border-red-200 bg-white text-red-700"
                      : "border-zinc-300 bg-white text-zinc-700"
                  }`}
                >
                  {LABEL[kind]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <UndoNotice notice={notice} pending={pending} onUndo={undo} onExpire={expire} />
    </div>
  );
}
