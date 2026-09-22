"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { bulkInboxAction, type BulkKind } from "./actions";

/**
 * Atributo de las casillas de cada fila (las renderiza el Server Component de la lista, que
 * escribe el mismo literal: una constante exportada desde un módulo "use client" no llega como
 * string al servidor).
 */
const SELECT_ATTR = "data-inbox-select";

const small = "rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-700";

/**
 * Selección múltiple en /inbox (JS-049). Las casillas de las filas son inputs sin estado de
 * React; esta barra las lee del DOM, así la lista sigue siendo un Server Component. "Seleccionar
 * todos" marca solo las filas de la pestaña actual (las que se ven). Eliminar pide una sola
 * confirmación con la cantidad.
 */
export function BulkBar({ total, shown }: { total: number; shown: number }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const boxes = () =>
    [...document.querySelectorAll<HTMLInputElement>(`input[${SELECT_ATTR}]`)].filter(
      (b) => !b.disabled,
    );
  const read = useCallback(
    () =>
      setIds(
        boxes()
          .filter((b) => b.checked)
          .map((b) => b.value),
      ),
    [],
  );

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e.target as HTMLElement).hasAttribute?.(SELECT_ATTR)) read();
    };
    // Al montar no hay nada tildado: la selección arranca vacía y se lee en cada cambio
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [read]);

  const all = shown > 0 && ids.length === shown;
  const toggleAll = (checked: boolean) => {
    for (const b of boxes()) b.checked = checked;
    read();
  };

  const run = (kind: BulkKind) => {
    const n = ids.length;
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
      await bulkInboxAction(kind, ids);
      toggleAll(false);
      router.refresh();
    });
  };

  if (shown === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-zinc-600">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => toggleAll(e.target.checked)}
          aria-label="Seleccionar todos"
          className="h-4 w-4"
        />
        Seleccionar todos
        {total > shown ? ` (se ven ${shown} de ${total}; los demás aparecen al limpiar estos)` : ""}
      </label>
      {ids.length > 0 ? (
        <div
          role="toolbar"
          aria-label="Acciones en lote"
          className={`sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs shadow-sm ${
            pending ? "opacity-60" : ""
          }`}
        >
          <span className="font-medium text-zinc-800">
            {ids.length} {ids.length === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <button type="button" disabled={pending} onClick={() => run("seen")} className={small}>
            Marcar visto
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("dismiss")}
            className={small}
            title="Estas fuentes no me sirven"
          >
            No me sirve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("delete")}
            className="rounded border border-red-200 bg-white px-2 py-1 text-red-700"
          >
            Eliminar
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => toggleAll(false)}
            className="ml-auto text-zinc-500 underline"
          >
            Cancelar selección
          </button>
        </div>
      ) : null}
    </div>
  );
}
