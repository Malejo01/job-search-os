import Link from "next/link";
import {
  HISTORY_BULLET_MAX_CHARS,
  HISTORY_ERROR_MESSAGES,
  HISTORY_FIELD_MAX_CHARS,
  HISTORY_KINDS,
  HISTORY_KIND_LABELS,
  HISTORY_MAX_BULLETS,
  HISTORY_MAX_ENTRIES,
  isHistoryField,
} from "@/lib/career-history-core";
import { listCareerHistory, type HistoryRow } from "@/lib/career-history";
import { requireUserId } from "@/lib/session";
import { addHistoryAction, deleteHistoryAction, updateHistoryAction } from "./actions";

export const metadata = { title: "Tu historial" };
export const dynamic = "force-dynamic";

const INPUT =
  "min-h-11 rounded-control border border-line-control bg-surface px-3 py-2 text-base text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const BUTTON =
  "inline-flex min-h-11 items-center rounded-control px-4 py-2 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function months(row: Pick<HistoryRow, "startMonth" | "endMonth" | "kind">): string {
  if (!row.startMonth && !row.endMonth) return "";
  const end = row.endMonth ?? (row.kind === "trabajo" ? "actual" : "");
  return [row.startMonth, end].filter(Boolean).join(" a ");
}

function EntryFields({ row, prefix }: { row?: HistoryRow; prefix: string }) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <>
      <label htmlFor={id("kind")} className="flex flex-col gap-1 text-sm font-medium text-fg">
        Tipo
        <select id={id("kind")} name="kind" defaultValue={row?.kind ?? "trabajo"} className={INPUT}>
          {HISTORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {HISTORY_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label
        htmlFor={id("organization")}
        className="flex flex-col gap-1 text-sm font-medium text-fg"
      >
        Empresa o institución
        <input
          id={id("organization")}
          name="organization"
          required
          maxLength={HISTORY_FIELD_MAX_CHARS}
          defaultValue={row?.organization ?? ""}
          className={INPUT}
        />
      </label>
      <label htmlFor={id("title")} className="flex flex-col gap-1 text-sm font-medium text-fg">
        Cargo o título
        <input
          id={id("title")}
          name="title"
          required
          maxLength={HISTORY_FIELD_MAX_CHARS}
          defaultValue={row?.title ?? ""}
          className={INPUT}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <label htmlFor={id("start")} className="flex flex-col gap-1 text-sm font-medium text-fg">
          Inicio
          <input
            id={id("start")}
            name="startMonth"
            type="month"
            defaultValue={row?.startMonth ?? ""}
            className={INPUT}
          />
        </label>
        <label htmlFor={id("end")} className="flex flex-col gap-1 text-sm font-medium text-fg">
          Fin (vacío si sigue)
          <input
            id={id("end")}
            name="endMonth"
            type="month"
            defaultValue={row?.endMonth ?? ""}
            className={INPUT}
          />
        </label>
      </div>
      <label htmlFor={id("bullets")} className="flex flex-col gap-1 text-sm font-medium text-fg">
        Qué hiciste y qué lograste
        <textarea
          id={id("bullets")}
          name="bullets"
          rows={4}
          defaultValue={row?.bullets.join("\n") ?? ""}
          aria-describedby={id("bullets-help")}
          className={INPUT}
        />
        <span id={id("bullets-help")} className="text-xs font-normal text-fg-muted">
          Una viñeta por línea, hasta {HISTORY_MAX_BULLETS} de {HISTORY_BULLET_MAX_CHARS}{" "}
          caracteres, sin links.
        </span>
      </label>
    </>
  );
}

/**
 * Tu historial (C-25, CVC-2): carga y edición manual de trabajos, estudios y certificaciones, que son
 * la fuente del CV. Server Component con server actions; los errores vuelven por la URL como el nombre
 * del campo, nunca como el valor que escribió la persona.
 */
export default async function HistorialPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const userId = await requireUserId();
  const { error, ok } = await searchParams;
  const rows = await listCareerHistory(userId);
  const errorText = isHistoryField(error)
    ? HISTORY_ERROR_MESSAGES[error]
    : error
      ? "No pudimos guardar los cambios. Probá de nuevo en un rato."
      : null;
  const full = rows.length >= HISTORY_MAX_ENTRIES;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Link href="/settings" className="text-sm text-fg underline">
        Ajustes
      </Link>
      <h1 className="text-2xl font-semibold text-fg">Tu historial</h1>
      <p className="text-sm text-fg-muted">
        Trabajos, estudios y certificaciones que aparecen en tu CV. Solo se usa lo que cargás acá;
        nada se inventa. Hasta {HISTORY_MAX_ENTRIES} entradas.
      </p>

      {errorText ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorText}
        </p>
      ) : null}
      {ok === "saved" || ok === "deleted" ? (
        <p role="status" className="rounded-control bg-success-soft px-3 py-2 text-sm text-success">
          {ok === "saved" ? "Guardado." : "Entrada borrada."}{" "}
          <Link href="/cv" className="underline">
            Ver mi CV
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="entradas" className="flex flex-col gap-3">
        <h2 id="entradas" className="text-lg font-medium text-fg">
          Tus entradas
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted">Todavía no cargaste nada.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid="history-entry"
                className="rounded-card border border-line bg-surface p-3"
              >
                <p className="text-sm font-medium text-fg">
                  {row.title} · {row.organization}
                </p>
                <p className="text-xs text-fg-muted">
                  {HISTORY_KIND_LABELS[row.kind]}
                  {months(row) ? ` · ${months(row)}` : ""}
                </p>
                <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm text-fg underline">
                    Editar
                  </summary>
                  <form action={updateHistoryAction} className="flex flex-col gap-3 pt-2">
                    <input type="hidden" name="id" value={row.id} />
                    <EntryFields row={row} prefix={`e-${row.id}`} />
                    <button
                      type="submit"
                      className={`self-start bg-brand text-brand-contrast hover:bg-brand-hover ${BUTTON}`}
                    >
                      Guardar cambios
                    </button>
                  </form>
                </details>
                <form action={deleteHistoryAction} className="mt-1">
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    aria-label={`Borrar ${row.title} en ${row.organization}`}
                    className={`text-danger underline ${BUTTON}`}
                  >
                    Borrar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="nueva"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
      >
        <h2 id="nueva" className="text-lg font-medium text-fg">
          Sumar una entrada
        </h2>
        {full ? (
          <p className="text-sm text-fg-muted">{HISTORY_ERROR_MESSAGES.limit}</p>
        ) : (
          <form action={addHistoryAction} className="flex flex-col gap-3">
            <EntryFields prefix="nueva" />
            <button
              type="submit"
              className={`self-start bg-brand text-brand-contrast hover:bg-brand-hover ${BUTTON}`}
            >
              Agregar
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
