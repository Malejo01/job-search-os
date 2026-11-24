import {
  BETA_LAUNCH_ROLE_KEYS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  filterFeedback,
  groupFeedbackByScreen,
  isFeedbackCategory,
  isRoleKey,
  parseFeedbackFilters,
  readableActions,
  splitFeedbackSuggestion,
  type FeedbackStatus,
  type ScreenGroup,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses, inputClasses } from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { careerLabel } from "@/lib/career-market";
import { getFeedbackTriage } from "@/lib/feedback-triage";
import { requireUserId } from "@/lib/session";
import { setFeedbackStatusAction } from "./actions";

export const metadata: Metadata = { title: "Lo que nos contaron", robots: { index: false } };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const STATUS_TONE: Record<FeedbackStatus, string> = {
  nuevo: "bg-warning-soft text-warning",
  visto: "bg-info-soft text-info",
  resuelto: "bg-success-soft text-success",
};

const label = "flex flex-col gap-1 text-sm font-semibold";

/**
 * Triage del feedback de la beta (C8-17): filtros por carrera, categoría, página, fecha y estado; las
 * últimas acciones del chip en llano; estado nuevo / visto / resuelto y export CSV. Solo admins y con
 * `FEEDBACK_TRIAGE_ENABLED=1` (después de la migración 0059); si no, 404. Sin email ni nombre: la
 * persona va con su identificador seudónimo.
 */
export default async function FeedbackTriagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const result = await getFeedbackTriage(userId);
  if (!result.ok && (result.reason === "no_admin" || result.reason === "apagado")) notFound();
  const params = await searchParams;
  const filters = parseFeedbackFilters(params);
  // R26-04: los comentarios agrupados por pantalla (sin ids), de más a menos comentadas
  const screenGroups = result.ok ? groupFeedbackByScreen(result.rows) : [];
  const exportQuery = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  ).toString();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Lo que nos contaron</h1>
        <p className="text-sm text-fg-muted">
          Los últimos 500 comentarios de «Contanos qué pasó». Sin email ni nombre: cada persona
          tiene un identificador de 6 caracteres.
        </p>
      </div>

      <ScreenSummary groups={screenGroups} active={filters.screen} />

      <form method="get" className="grid gap-3 rounded-card bg-surface p-4 sm:grid-cols-3">
        <label className={label}>
          Carrera
          <select name="carrera" defaultValue={filters.career ?? ""} className={inputClasses()}>
            <option value="">Todas</option>
            {BETA_LAUNCH_ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {careerLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Categoría
          <select name="categoria" defaultValue={filters.category ?? ""} className={inputClasses()}>
            <option value="">Todas</option>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {FEEDBACK_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Estado
          <select name="estado" defaultValue={filters.status ?? ""} className={inputClasses()}>
            <option value="">Todos</option>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Pantalla
          <select name="pantalla" defaultValue={filters.screen ?? ""} className={inputClasses()}>
            <option value="">Todas</option>
            {screenGroups.map((g) => (
              <option key={g.screen} value={g.screen}>
                {g.screen} ({g.count})
              </option>
            ))}
            {filters.screen && !screenGroups.some((g) => g.screen === filters.screen) ? (
              <option value={filters.screen}>{filters.screen} (0)</option>
            ) : null}
          </select>
        </label>
        <label className={label}>
          Página (empieza con)
          <input
            name="pagina"
            defaultValue={filters.path ?? ""}
            placeholder="/jobs"
            maxLength={200}
            className={inputClasses()}
          />
        </label>
        <label className={label}>
          Persona (identificador)
          <input
            name="persona"
            defaultValue={filters.person ?? ""}
            placeholder="a1b2c3"
            maxLength={6}
            autoComplete="off"
            className={inputClasses()}
          />
        </label>
        <label className={label}>
          Desde
          <input
            type="date"
            name="desde"
            defaultValue={filters.from ?? ""}
            className={inputClasses()}
          />
        </label>
        <label className={label}>
          Hasta
          <input
            type="date"
            name="hasta"
            defaultValue={filters.to ?? ""}
            className={inputClasses()}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <button type="submit" className={buttonClasses()}>
            Filtrar
          </button>
          <Link
            href="/admin/feedback"
            className="inline-flex min-h-11 items-center text-sm underline"
          >
            Limpiar
          </Link>
          <a
            href={`/admin/feedback/export${exportQuery ? `?${exportQuery}` : ""}`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline"
          >
            Descargar CSV (lo filtrado)
          </a>
        </div>
      </form>

      {!result.ok ? (
        <p role="status" className="rounded-card bg-surface p-4 text-sm">
          No se pudieron leer los comentarios (¿falta aplicar la migración 0059?).
        </p>
      ) : (
        <FeedbackList rows={filterFeedback(result.rows, filters)} total={result.rows.length} />
      )}
    </div>
  );
}

/** «Por pantalla» (R26-04): cuántos comentarios hay en cada pantalla y cuántos siguen nuevos; cada una filtra la lista. */
function ScreenSummary({ groups, active }: { groups: ScreenGroup[]; active: string | null }) {
  if (groups.length === 0) return null;
  return (
    <section
      aria-labelledby="feedback-por-pantalla"
      data-testid="feedback-por-pantalla"
      className="flex flex-col gap-2 rounded-card bg-surface p-4"
    >
      <h2 id="feedback-por-pantalla" className="text-heading font-bold">
        Por pantalla
      </h2>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {groups.map((g) => (
          <li key={g.screen}>
            <Link
              href={`/admin/feedback?pantalla=${encodeURIComponent(g.screen)}`}
              aria-current={g.screen === active ? "true" : undefined}
              data-testid="feedback-pantalla-grupo"
              className="inline-flex min-h-11 items-center gap-2 rounded-pill border-2 border-line-strong px-3 text-sm hover:bg-surface-muted aria-[current=true]:border-line-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <code>{g.screen}</code>
              <span className="font-bold">{g.count}</span>
              {g.nuevos > 0 ? (
                <span className="text-xs text-fg-subtle">
                  {g.nuevos === 1 ? "1 nuevo" : `${g.nuevos} nuevos`}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeedbackList({ rows, total }: { rows: ReturnType<typeof filterFeedback>; total: number }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        {total === 0 ? "Todavía no hay comentarios." : "Ningún comentario con esos filtros."}
      </p>
    );
  }
  return (
    <ul data-testid="feedback-lista" className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((r) => {
        const actions = readableActions(r.actions);
        const text = splitFeedbackSuggestion(r.message);
        return (
          <li
            key={r.id}
            data-testid="feedback-item"
            className="flex flex-col gap-2 rounded-card bg-surface p-4 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
              <span className={`rounded-badge px-2 py-0.5 font-bold ${STATUS_TONE[r.status]}`}>
                {FEEDBACK_STATUS_LABELS[r.status]}
              </span>
              <span>{DATE.format(r.createdAt)}</span>
              <span>·</span>
              <span>
                {isFeedbackCategory(r.category) ? FEEDBACK_CATEGORY_LABELS[r.category] : r.category}
              </span>
              <span>·</span>
              <code>{r.path}</code>
              <span>·</span>
              <span>{r.career && isRoleKey(r.career) ? careerLabel(r.career) : "sin carrera"}</span>
              <span>·</span>
              <Link
                href={`/admin/feedback?persona=${encodeURIComponent(r.person)}`}
                className="inline-flex min-h-11 items-center underline"
                aria-label={`Ver solo lo de la persona ${r.person}`}
              >
                persona {r.person}
              </Link>
            </div>
            <p className="whitespace-pre-wrap break-words text-fg" data-testid="feedback-mensaje">
              {text.message}
            </p>
            {text.suggestion ? (
              <div data-testid="feedback-sugerencia" className="flex flex-col gap-0.5">
                <p className="text-xs font-semibold text-fg-subtle">¿Qué te gustaría que cambie?</p>
                <p className="whitespace-pre-wrap break-words text-fg">{text.suggestion}</p>
              </div>
            ) : null}
            {actions.length > 0 ? (
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-fg-muted underline">
                  Qué hizo antes ({actions.length})
                </summary>
                <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-5 text-xs text-fg-muted">
                  {actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </details>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_STATUSES.filter((st) => st !== r.status).map((st) => (
                <form key={st} action={setFeedbackStatusAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value={st} />
                  <button
                    type="submit"
                    className={buttonClasses({
                      variant: "secondary",
                      size: "sm",
                      className: "min-h-11",
                    })}
                  >
                    Marcar como {FEEDBACK_STATUS_LABELS[st].toLowerCase()}
                  </button>
                </form>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
