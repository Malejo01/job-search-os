"use client";

import { deleteAction } from "./actions";

/** "Eliminar" con confirmación: es la única acción de /inbox que borra de la base. */
export function DeleteButton({
  id,
  subject,
  volver = false,
}: {
  id: string;
  subject: string | null;
  volver?: boolean;
}) {
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
      {volver ? <input type="hidden" name="volver" value="1" /> : null}
      <button
        type="submit"
        className="rounded-control border border-danger-line px-2 py-1 text-danger"
      >
        Eliminar
      </button>
    </form>
  );
}
