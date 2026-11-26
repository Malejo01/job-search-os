import {
  offerMetaLine,
  offerPlace,
  summarizeRequirements,
  withCurrentSkillLevels,
} from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import { AffinitySealLink } from "@/components/affinity-seal-link";
import { SealStamp } from "@/components/motion/seal-stamp";
import { cardClasses, CheckMark, cx, Seal } from "@/components/ui";
import type { JobDetail } from "@/lib/job-detail";
import { ESTADO_REQUISITO_TEXTOS, LISTADO_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";

/** El texto del aviso que se ve en el resumen: las primeras líneas, sin cortar una palabra. */
const JD_EXCERPT = 200;

function excerpt(text: string | null): string | null {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= JD_EXCERPT) return clean;
  const cut = clean.slice(0, JD_EXCERPT);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd()}…`;
}

/**
 * Detalle D3 (C10-8): copia del panel derecho de ofertas-pc.png y de detalle-cel.png, con las
 * medidas de `S2-hoy-ofertas.html`. Server Component.
 *
 * - `page` (`/jobs/[id]`): en el celular, cabecera índigo curva con «‹ Ofertas», el puesto (h1) y
 *   la empresa; debajo, el sello de 78 px con la frase de cercanía y la barra. Desde `sm`, la
 *   tarjeta destacada con el título de 26 px y el sello de 88 a la derecha.
 * - `panel` (lista y detalle lado a lado, desde `lg`): siempre la tarjeta.
 *
 * Después: el checklist (`.cardl`, check lima o aro; sin recuadro de «paso»: regla 6 del plan, no se
 * invita a sumar al CV lo que la persona no declaró); el comienzo del aviso y las acciones (`actions`). Los textos
 * de cercanía y de lo que falta salen del checklist de la evaluación (C9): no se inventan datos.
 */
export function OfferD3({
  job,
  variant,
  backHref = "/jobs",
  actions,
}: {
  job: JobDetail;
  variant: "page" | "panel";
  backHref?: string;
  /** Postularme y lo que corresponda; van abajo del todo. */
  actions?: ReactNode;
}) {
  const ev = job.evaluation;
  const levels = new Map(
    Object.entries(job.skillInfo).flatMap(([slug, info]) =>
      info.level === null ? [] : [[slug, info.level] as const],
    ),
  );
  const checklist = ev?.checklist ? withCurrentSkillLevels(ev.checklist, levels) : null;
  // Las skills que el aviso solo nombra no cuentan (C9): la misma lista que el titular
  const items = checklist
    ? checklist.items.filter((i) => !(i.kind === "skill" && i.fuente.pide === "fuente"))
    : [];
  // La tabla es la única fuente (R30): conteos y estados salen de `summarizeRequirements`, los mismos
  // que usa la tarjeta. Sin predicciones ni «lo que falta».
  const summary = summarizeRequirements({ items });
  const stateById = new Map(summary.rows.map((r) => [r.id, r.state] as const));
  const total = summary.rows.length;
  const closeness =
    total > 0
      ? llenarTexto(LISTADO_TEXTOS.panel.resumen, {
          coincide: summary.counts.coincide,
          sinConfirmar: summary.counts.sinConfirmar,
          noCoincide: summary.counts.noCoincide,
        })
      : null;
  const pending = job.evaluating && !ev;
  const place = offerPlace({
    company: job.company,
    location: job.locationRaw,
    modality: job.modality,
  });
  const meta = offerMetaLine(job.modality, new Date(job.postedAt ?? job.firstSeenAt), new Date());
  const jd = excerpt(job.jdText);
  const page = variant === "page";
  const Title = page ? "h1" : "h2";
  const titleId = page ? "detalle-titulo" : "panel-oferta-titulo";

  // En la página hay dos sellos (cabecera de la computadora y fila del celular) y se ve uno solo
  const seal = () => {
    const stamp = (
      <SealStamp jobId={job.id} evaluated={Boolean(ev)}>
        <Seal score={ev ? ev.score : null} pending={pending} size="detail" />
      </SealStamp>
    );
    // R17-03: solo en el detalle de una oferta evaluada el sello abre el panel de afinidad
    return page && ev ? <AffinitySealLink>{stamp}</AffinitySealLink> : stamp;
  };

  return (
    <div
      data-testid="d3"
      // En el celular el resumen ocupa la primera pantalla, como detalle-cel.png: lo demás del
      // detalle empieza debajo
      className={cx("flex min-w-0 flex-col gap-3 sm:gap-4")}
    >
      <section
        aria-labelledby={titleId}
        className={cx(
          "flex min-w-0 flex-col gap-3 sm:gap-4",
          !page && cardClasses({ level: "featured", padding: "none", className: "px-[26px] py-6" }),
          page &&
            "sm:rounded-card sm:border-x-2 sm:border-t-2 sm:border-b-[6px] sm:border-line-strong sm:bg-surface sm:px-[26px] sm:py-6",
        )}
      >
        {/* Un solo título: en el celular es la cabecera índigo curva de detalle-cel.png (con
            «‹ Ofertas»); desde `sm`, el encabezado de la tarjeta con el sello de 88 px */}
        <header
          className={cx(
            "flex",
            page
              ? "-mx-4 flex-col gap-2 rounded-b-[36px] bg-ink px-5 pt-4 pb-[22px] text-on-ink sm:mx-0 sm:flex-row sm:items-start sm:gap-4 sm:rounded-none sm:bg-transparent sm:p-0 sm:text-fg"
              : "items-start gap-4",
          )}
        >
          {page ? (
            <Link
              href={backHref}
              className="-my-3 inline-flex min-h-11 items-center gap-1 self-start text-sm font-bold text-on-ink-muted hover:text-on-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand sm:hidden"
            >
              <span aria-hidden="true">‹</span> Ofertas
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <Title
              id={titleId}
              className={cx(
                "leading-[1.1] font-extrabold break-words",
                page
                  ? "text-[22px] leading-[1.15] text-on-ink sm:text-[26px] sm:leading-[1.1] sm:text-fg"
                  : "text-[26px] text-fg",
              )}
            >
              {job.title}
            </Title>
            <p
              className={cx(
                "font-medium",
                page
                  ? "mt-2 text-[13px] text-on-ink-muted sm:mt-1.5 sm:text-[15px] sm:text-fg-subtle"
                  : "mt-1.5 text-[15px] text-fg-subtle",
              )}
            >
              {place}
              <span className={page ? "hidden sm:inline" : undefined}> · {meta}</span>
            </p>
          </div>
          <div className={page ? "hidden sm:block" : undefined}>{seal()}</div>
        </header>

        <div className="flex items-center gap-3.5 px-1 sm:block sm:px-0">
          {page ? <div className="sm:hidden">{seal()}</div> : null}
          <div className="min-w-0 flex-1">
            {/* R30-09: en la página del detalle, lo que dice la pantalla sobre requisitos sale solo de
                la tabla de «Requisitos» y «Cómo encaja»; este resumen lo repetía con otras palabras */}
            {!page && closeness ? (
              <p
                data-testid="cercania"
                className="font-display text-[19px] leading-[1.25] font-bold text-fg"
              >
                {closeness}
              </p>
            ) : pending ? (
              <p className="font-display text-[19px] leading-[1.25] font-bold text-fg-muted">
                Leyendo la oferta contra tu perfil…
              </p>
            ) : null}
            {!page && total > 0 ? (
              <div
                role="progressbar"
                aria-label={LISTADO_TEXTOS.panel.barra}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={summary.counts.coincide}
                className="mt-2.5 h-2.5 overflow-hidden rounded-[5px] bg-line sm:mt-2.5"
              >
                <div
                  className="h-full bg-brand shadow-[inset_0_-3px_0_var(--jso-edge-brand)]"
                  style={{ width: `${Math.round((summary.counts.coincide / total) * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>

        {!page && items.length ? (
          <div className="grid gap-3 sm:gap-3.5">
            <ul
              aria-label="Lo que pide el aviso"
              className={cardClasses({
                level: "list",
                padding: "none",
                className: "m-0 flex list-none flex-col gap-3 px-[18px] py-4",
              })}
            >
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-2.5">
                  <CheckMark done={stateById.get(item.id) === "coincide"} />
                  <span
                    className={cx(
                      "min-w-0 text-sm break-words text-fg",
                      stateById.get(item.id) === "coincide" ? "font-semibold" : "font-bold",
                    )}
                  >
                    {item.pide}
                    <span className="sr-only">
                      {` (${ESTADO_REQUISITO_TEXTOS[stateById.get(item.id) ?? "sinConfirmar"].toLowerCase()})`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!page && jd ? (
          <p className="hidden text-sm leading-[1.55] font-medium text-fg-muted sm:block">{jd}</p>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center gap-3 sm:mt-2">{actions}</div>
        ) : null}
      </section>
    </div>
  );
}
