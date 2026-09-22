import { dismissAction, markSeenAction, restoreAction } from "./actions";
import { DeleteButton } from "./delete-button";

const small = "rounded border border-zinc-300 px-2 py-1 text-zinc-700";

/**
 * Acciones de un email (JS-038), las mismas en la lista de /inbox y arriba del detalle
 * (JS-039). `volver`: después de eliminar o de volver a pendientes, ir a /inbox. Desde el
 * detalle no hay nada que ver después de eliminar, y quedarse lo volvería a marcar visto (abrir
 * el detalle lo marca). "No me sirve" sigue disponible en un email visto.
 */
export function EmailActions({
  id,
  subject,
  seen,
  dismissed,
  volver = false,
}: {
  id: string;
  subject: string | null;
  seen: boolean;
  dismissed: boolean;
  volver?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Acciones del email"
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      {seen || dismissed ? (
        <form action={restoreAction}>
          <input type="hidden" name="id" value={id} />
          {volver ? <input type="hidden" name="volver" value="1" /> : null}
          <button type="submit" className={small}>
            Volver a pendientes
          </button>
        </form>
      ) : (
        <form action={markSeenAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={small}>
            Marcar visto
          </button>
        </form>
      )}
      {dismissed ? null : (
        <form action={dismissAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={small} title="Esta fuente no me sirve">
            No me sirve
          </button>
        </form>
      )}
      <DeleteButton id={id} subject={subject} volver={volver} />
    </div>
  );
}
