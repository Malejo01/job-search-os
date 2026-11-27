import {
  COVERAGE_ENTRY_THRESHOLD,
  COVERAGE_TOMABLE_THRESHOLD,
  summarizeCareerOpening,
  type CareerCoverageRow,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { SubmitButton } from "@/app/components/submit-button";
import { Alert, buttonClasses, cardClasses } from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { catalogLabel } from "@/lib/career-names";
import {
  listCareerOpeningHistory,
  listOpenCareersAdmin,
  type CareerOpeningEventRow,
  type OpenCareerRow,
} from "@/lib/careers-open";
import { getCobertura } from "@/lib/cobertura";
import { requireUserId } from "@/lib/session";
import { ALTA_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { setCareerOpenAction } from "./actions";

export const metadata: Metadata = { title: "Apertura por carrera", robots: { index: false } };
export const dynamic = "force-dynamic";

const T = ALTA_TEXTOS.apertura;

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Buenos_Aires",
});
const WHEN = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** Etiqueta de una clave de carrera para pantalla; una clave que ya no está en el catálogo se muestra tal cual. */
function labelOf(career: string): string {
  try {
    return catalogLabel(career as Parameters<typeof catalogLabel>[0]);
  } catch {
    return career;
  }
}

function coverageText(row: CareerCoverageRow | undefined): string {
  if (!row) return T.sinCobertura;
  return `${T.semaforo[row.semaforo]} · ${llenarTexto(T.coberturaFila, {
    tomables: row.tomables,
    empieza: row.paraEmpezar,
  })}`;
}

/**
 * Apertura por carrera (R32-03): solo admins (404 para el resto). La lista de carreras abiertas vive en la base y
 * la cambia el responsable desde acá; cada cambio queda con quién y cuándo. Nada abre solo: la cobertura
 * informa al lado, pero no decide. Server Component y formularios nativos, sin JavaScript en el navegador.
 */
export default async function CarrerasPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const { ok, error } = await searchParams;
  const [open, history, cobertura]: [
    OpenCareerRow[] | null,
    CareerOpeningEventRow[] | null,
    Awaited<ReturnType<typeof getCobertura>>,
  ] = await Promise.all([
    listOpenCareersAdmin(userId).catch(() => null),
    listCareerOpeningHistory(userId, 30).catch(() => null),
    getCobertura(userId),
  ]);
  const rows = open === null ? [] : summarizeCareerOpening(open.map((o) => o.career));
  const openedBy = new Map((open ?? []).map((o) => [o.career as string, o]));
  const coverage = new Map((cobertura.ok ? cobertura.rows : []).map((r) => [r.role, r] as const));
  const okMessage = ok && ok in T.ok ? T.ok[ok as keyof typeof T.ok] : null;
  const errorMessage =
    error && error in T.errores ? T.errores[error as keyof typeof T.errores] : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">{T.titulo}</h1>
        <p className="text-sm text-fg-muted">{T.intro}</p>
        <p className="text-sm font-medium text-fg">
          {llenarTexto(T.umbral, {
            tomables: COVERAGE_TOMABLE_THRESHOLD,
            empieza: COVERAGE_ENTRY_THRESHOLD,
          })}{" "}
          <Link
            href="/admin/cobertura"
            className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {T.verCobertura}
          </Link>
        </p>
      </div>

      {okMessage ? (
        <Alert tone="success" role="status" data-testid="carreras-ok">
          {okMessage}
        </Alert>
      ) : null}
      {errorMessage ? (
        <Alert tone="danger" role="alert" data-testid="carreras-error">
          {errorMessage}
        </Alert>
      ) : null}

      {open === null ? (
        <Alert tone="danger" role="alert" data-testid="carreras-sin-lectura">
          {T.noLeyo}
        </Alert>
      ) : (
        <section
          aria-labelledby="carreras-lista"
          className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}
        >
          <h2 id="carreras-lista" className="sr-only">
            {T.titulo}
          </h2>
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((r) => {
              const label = labelOf(r.career);
              const who = openedBy.get(r.career);
              return (
                <li
                  key={r.career}
                  data-testid={`carrera-${r.career}`}
                  data-abierta={r.open ? "si" : "no"}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-bold text-fg">{label}</span>
                    <span className="text-sm text-fg-muted">
                      <span className="font-semibold text-fg">
                        {r.open ? T.abierta : T.cerrada}
                      </span>
                      {" · "}
                      {coverageText(coverage.get(r.career))}
                    </span>
                    {r.open && who ? (
                      <span className="text-xs text-fg-subtle">
                        {who.openedByEmail
                          ? llenarTexto(T.abiertaDesde, {
                              fecha: DATE.format(who.openedAt),
                              quien: who.openedByEmail,
                            })
                          : llenarTexto(T.abiertaSinQuien, { fecha: DATE.format(who.openedAt) })}
                      </span>
                    ) : null}
                  </div>
                  <form action={setCareerOpenAction}>
                    <input type="hidden" name="career" value={r.career} />
                    <input type="hidden" name="open" value={r.open ? "no" : "si"} />
                    <SubmitButton
                      className={buttonClasses({
                        size: "sm",
                        variant: r.open ? "secondary" : "primary",
                      })}
                      pendingLabel="Guardando…"
                    >
                      {llenarTexto(r.open ? T.cerrar : T.abrir, { carrera: label })}
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-fg-subtle">{T.otraAviso}</p>
        </section>
      )}

      <section
        aria-labelledby="carreras-historial"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-2" })}
      >
        <h2 id="carreras-historial" className="text-heading font-medium">
          {T.historialTitulo}
        </h2>
        {history === null ? (
          <p className="text-sm text-fg-muted">{T.noLeyo}</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-fg-subtle" data-testid="carreras-historial-vacio">
            {T.historialVacio}
          </p>
        ) : (
          <ul
            className="flex flex-col gap-1 text-sm text-fg-muted"
            data-testid="carreras-historial"
          >
            {history.map((h, i) => (
              <li key={`${h.createdAt.toISOString()}-${i}`}>
                {llenarTexto(h.action === "abrir" ? T.historialAbrir : T.historialCerrar, {
                  quien: h.adminEmail ?? T.quienNinguno,
                  carrera: labelOf(h.career),
                  fecha: WHEN.format(h.createdAt),
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
