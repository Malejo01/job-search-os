"use client";

import { deleteAction } from "./actions";

/** "Eliminar" con confirmación: es la única acción de /inbox que borra de la base. */
export function DeleteButton({ id, subject }: { id: string; subject: string | null }) {
  return (
    <form
      action={deleteAction}
      onSubmit={(e) => {
        const ok = window.confirm(
          `¿Eliminar "${subject ?? "(sin asunto)"}"? Se borra de la base y no se puede deshacer.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="rounded border border-red-200 px-2 py-1 text-red-700">
        Eliminar
      </button>
    </form>
  );
}
