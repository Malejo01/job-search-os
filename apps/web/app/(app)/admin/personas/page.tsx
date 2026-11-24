import {
  PEOPLE_FILTERS,
  PEOPLE_PAGE_SIZE,
  parsePeopleFilter,
  parsePeoplePage,
  parsePeopleQuery,
  personBadges,
  type PeopleFilter,
} from "@job-search-os/pipeline";
import Link from "next/link";
import {
  Alert,
  Badge,
  buttonClasses,
  cardClasses,
  cx,
  filterChipClasses,
  inputClasses,
  labelClasses,
} from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { listPeople, type PersonRow } from "@/lib/people-admin";
import { requireUserId } from "@/lib/session";

/**
 * Personas (ADM-1): todas las cuentas, con búsqueda por email o nombre y filtros por plan, rol y estado.
 * Tocar una abre su ficha, donde se cambian el rol tester, el bloqueo y la cuenta de prueba.
 */
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        dateStyle: "medium",
      })
    : "—";

function href(q: string | null, filter: PeopleFilter, page = 1): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (filter !== "todas") p.set("filtro", filter);
  if (page > 1) p.set("pagina", String(page));
  const s = p.toString();
  return s ? `/admin/personas?${s}` : "/admin/personas";
}

export default async function PersonasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const sp = await searchParams;
  const q = parsePeopleQuery(sp.q);
  const filter = parsePeopleFilter(sp.filtro);
  const page = parsePeoplePage(sp.pagina);

  let result: { rows: PersonRow[]; total: number } | null;
  try {
    result = await listPeople(userId, { query: q, filter, page });
  } catch {
    result = null;
  }
  const now = new Date();
  const pages = result ? Math.max(1, Math.ceil(result.total / PEOPLE_PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Personas</h1>
        <p className="text-fg-muted">
          Todas las cuentas de la beta. Abrí una para cambiar su plan, darle el rol de tester o
          bloquear su acceso.
        </p>
      </header>

      <form
        method="get"
        action="/admin/personas"
        role="search"
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="q" className={labelClasses()}>
            Buscar por email o nombre
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            maxLength={120}
            autoComplete="off"
            className={inputClasses()}
          />
        </div>
        {filter !== "todas" ? <input type="hidden" name="filtro" value={filter} /> : null}
        <button type="submit" className={buttonClasses({ variant: "secondary" })}>
          Buscar
        </button>
      </form>

      <nav aria-label="Filtros" className="-mx-1 flex flex-wrap gap-2">
        {PEOPLE_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href(q, f.key)}
            aria-current={f.key === filter ? "page" : undefined}
            className={filterChipClasses({ selected: f.key === filter })}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {result === null ? (
        <Alert tone="danger" role="alert">
          No se pudo leer la lista. Si es la primera vez, falta aplicar la migración del panel
          (rls/0064).
        </Alert>
      ) : result.rows.length === 0 ? (
        <p className={cardClasses({ padding: "md", className: "text-fg-muted" })}>
          {q || filter !== "todas"
            ? "Nadie coincide con esa búsqueda o filtro."
            : "Todavía no hay cuentas."}
        </p>
      ) : (
        <>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {result.total === 1 ? "1 persona" : `${result.total} personas`}
            {pages > 1 ? ` · página ${page} de ${pages}` : ""}
          </p>
          <ul
            className={cardClasses({
              padding: "none",
              className: "divide-y divide-line overflow-hidden",
            })}
          >
            {result.rows.map((p) => {
              const badges = personBadges(p, now);
              return (
                <li key={p.id}>
                  <Link
                    href={`/admin/personas/${p.id}`}
                    className="flex flex-col gap-2 px-4 py-3 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.name || "Sin nombre"}</span>
                      <span className="block text-sm break-all text-fg-muted">{p.email}</span>
                      <span className="block text-xs text-fg-subtle">
                        Alta {fmtDate(p.createdAt)} · Último uso con IA {fmtDate(p.lastAiAt)}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1 sm:max-w-[50%] sm:justify-end">
                      {badges.map((b) => (
                        <Badge key={b.key} tone={b.tone}>
                          {b.label}
                        </Badge>
                      ))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Páginas" className="flex items-center justify-between gap-2">
              {page > 1 ? (
                <Link
                  href={href(q, filter, page - 1)}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Anterior
                </Link>
              ) : (
                <span />
              )}
              {page < pages ? (
                <Link
                  href={href(q, filter, page + 1)}
                  className={cx(buttonClasses({ variant: "secondary", size: "sm" }))}
                >
                  Siguiente
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
