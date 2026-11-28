import Link from "next/link";
import type { ChipKey } from "@job-search-os/pipeline";
import { filterChipClasses } from "@/components/ui";
import { listQuery, type JobFilters } from "@/lib/jobs";
import { LISTADO_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { LinkPending } from "./jobs-loading";

const T = LISTADO_TEXTOS;

type TabKey = "porRevisar" | "guardadas" | "yaMePostule" | "descartadas" | "todas";

/** Qué pestaña está activa según los filtros de la URL; null si el estado viene de un filtro fino. */
export function activeTab(f: JobFilters): TabKey | null {
  if (f.saved) return "guardadas";
  if (f.status === null) return "porRevisar";
  if (f.status === "aplicada") return "yaMePostule";
  if (f.status === "descartada") return "descartadas";
  if (f.status === "todas") return "todas";
  return null;
}

/** Cada pestaña es un link: cambia el estado y deja los chips activos. */
const TAB_PATCH: Record<TabKey, Partial<JobFilters>> = {
  porRevisar: { status: null, saved: false },
  guardadas: { status: null, saved: true },
  yaMePostule: { status: "aplicada", saved: false },
  descartadas: { status: "descartada", saved: false },
  todas: { status: "todas", saved: false },
};
const TABS: readonly TabKey[] = ["porRevisar", "guardadas", "yaMePostule", "descartadas", "todas"];

/** El chip prende o apaga su propio filtro de la URL. */
function chipPatch(key: ChipKey, on: boolean): Partial<JobFilters> {
  switch (key) {
    case "remoto":
      return { modalidad: on ? null : "remoto" };
    case "cerca":
      return { cerca: !on };
    case "pais":
      return { aceptanPais: !on };
    case "espanol":
      return { idioma: on ? null : "es" };
    case "inicio":
      return { paraEmpezar: !on };
  }
}

export function activeChips(f: JobFilters): ChipKey[] {
  const out: ChipKey[] = [];
  if (f.modalidad) out.push("remoto");
  if (f.cerca) out.push("cerca");
  if (f.aceptanPais) out.push("pais");
  if (f.idioma === "es") out.push("espanol");
  if (f.paraEmpezar) out.push("inicio");
  return out;
}

/** Nombre del país en español a partir del ISO-2 del perfil; sin nombre conocido, el código. */
export function countryName(iso2: string): string {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}

/**
 * Pestañas, chips con su número y contador de la lista (R30-05). Server Component: todo son links y
 * los filtros viven en la URL, así se comparten y el botón «atrás» funciona. El estado activo lleva
 * texto («×») además del color. Sin ciudad o sin país en el perfil, esos chips no se muestran.
 */
export function JobsNav({
  filters,
  counts,
  city,
  countryLabel,
  shown,
}: {
  filters: JobFilters;
  counts: Record<ChipKey, number>;
  city: string | null;
  countryLabel: string | null;
  /** Cuántas ofertas quedan en pantalla con los filtros actuales. */
  shown: number;
}) {
  const href = (patch: Partial<JobFilters>) => `/jobs${listQuery({ ...filters, ...patch })}`;
  const tab = activeTab(filters);
  const active = activeChips(filters);
  const chips: { key: ChipKey; label: string }[] = [
    { key: "remoto", label: T.filtros.remoto },
    ...(city
      ? [{ key: "cerca" as const, label: llenarTexto(T.filtros.enCiudad, { ciudad: city }) }]
      : []),
    ...(countryLabel
      ? [
          {
            key: "pais" as const,
            label: llenarTexto(T.filtros.aceptanPais, { pais: countryLabel }),
          },
        ]
      : []),
    { key: "espanol", label: T.filtros.enEspanol },
    { key: "inicio", label: T.filtros.paraEmpezar },
  ];
  const recientes = filters.orden === "recientes";
  const hasChips = active.length > 0 || recientes;
  const counter =
    active.length > 0
      ? shown === 1
        ? T.filtros.contadorUno
        : llenarTexto(T.filtros.contador, { n: shown })
      : shown === 1
        ? T.filtros.totalUno
        : llenarTexto(T.filtros.total, { n: shown });

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label={T.tabs.aria}
        data-testid="jobs-pestanas"
        className="flex gap-1.5 overflow-x-auto pb-0.5"
      >
        {TABS.map((k) => (
          <Link
            key={k}
            href={href(TAB_PATCH[k])}
            aria-current={tab === k ? "page" : undefined}
            data-testid={`pestana-${k}`}
            className={filterChipClasses({
              compact: true,
              selected: tab === k,
              className: "shrink-0",
            })}
          >
            {T.tabs[k]}
            <LinkPending />
          </Link>
        ))}
      </nav>
      <nav
        aria-label={T.filtros.aria}
        data-testid="jobs-chips"
        className="flex flex-wrap items-center gap-1.5 sm:gap-2"
      >
        {chips.map(({ key, label }) => {
          const on = active.includes(key);
          return (
            <Link
              key={key}
              href={href(chipPatch(key, on))}
              aria-current={on ? "true" : undefined}
              data-testid={`chip-${key}`}
              className={filterChipClasses({ compact: true, selected: on, className: "shrink-0" })}
            >
              <span>{`${label} · ${counts[key]}`}</span>
              {on ? (
                <>
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">
                    {llenarTexto(T.filtros.quitarFiltro, { nombre: label })}
                  </span>
                </>
              ) : null}
              <LinkPending />
            </Link>
          );
        })}
        <Link
          href={href({ orden: recientes ? null : "recientes" })}
          aria-current={recientes ? "true" : undefined}
          aria-label={T.filtros.ordenAyuda}
          data-testid="chip-orden"
          className={filterChipClasses({
            compact: true,
            selected: recientes,
            className: "shrink-0",
          })}
        >
          {recientes ? T.filtros.ordenRecientes : T.filtros.ordenAfinidad}
          <LinkPending />
        </Link>
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p role="status" data-testid="jobs-contador" className="text-sm font-bold text-fg">
          {counter}
        </p>
        {hasChips ? (
          <Link
            href={href({
              modalidad: null,
              idioma: null,
              cerca: false,
              aceptanPais: false,
              paraEmpezar: false,
              orden: null,
            })}
            data-testid="limpiar-filtros"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {T.filtros.limpiar}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
