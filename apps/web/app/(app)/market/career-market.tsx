import type { CareerMarket as CareerMarketData } from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import { CareerSalary } from "@/components/career-salary";
import { BarGrow } from "./bar-grow";

/**
 * "Mercado de <carrera>" (ronda 58): lo que piden las ofertas públicas del pool de una carrera en los
 * últimos 30 días. Server Component. Cada barra va con su número en texto (la barra es decoración,
 * `aria-hidden`) y lo excluyente se distingue de lo deseable por el relleno, no solo por el color.
 */
const NF = new Intl.NumberFormat("es-AR");
const HOUR_MS = 60 * 60 * 1000;
const STALE_POOL_HOURS = 48;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** Ancho de una barra: con valor, al menos 4 px para que se vea; sin valor, sin barra. */
const barWidth = (count: number, share: number) => (count > 0 ? `max(${share}%, 4px)` : "0px");

const SENIORITY_LABELS = [
  ["junior", "Trainee/Junior"],
  ["semi", "Semi Senior"],
  ["senior", "Senior"],
  ["lead", "Lead o más"],
  ["unknown", "No dice"],
] as const;

const ENGLISH_LABELS = [
  ["basico", "Básico"],
  ["intermedio", "Intermedio"],
  ["avanzado", "Avanzado"],
  ["fluido", "Fluido"],
  ["sin_nivel", "Sin nivel"],
] as const;

const MODALITY_LABELS = [
  ["remoto", "Remoto"],
  ["hibrido", "Híbrido"],
  ["presencial", "Presencial"],
  ["desconocida", "No dice"],
] as const;

const STRIPES =
  "bg-[repeating-linear-gradient(135deg,#71717a_0,#71717a_3px,#d4d4d8_3px,#d4d4d8_6px)]";
const TRACK = "h-2 w-full overflow-hidden rounded bg-zinc-100 ring-1 ring-inset ring-zinc-200";

function updatedAgo(market: CareerMarketData): { text: string | null; stale: boolean } {
  if (!market.poolUpdatedAt) return { text: null, stale: false };
  const hours = Math.max(
    0,
    Math.floor((Date.parse(market.computedAt) - Date.parse(market.poolUpdatedAt)) / HOUR_MS),
  );
  const text =
    hours < 1
      ? "hace menos de una hora"
      : hours >= 48
        ? `hace ${Math.floor(hours / 24)} días`
        : `hace ${hours} h`;
  return { text, stale: hours > STALE_POOL_HOURS };
}

/** Fila con el texto completo y una barra decorativa de un solo relleno. */
function SimpleRow({ label, count, total }: { label: string; count: number; total: number }) {
  const share = pct(count, total);
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="break-words text-xs text-zinc-800">
        {label} · {NF.format(count)} {plural(count, "oferta", "ofertas")} ({share} %)
      </span>
      <div aria-hidden="true" className={TRACK}>
        <BarGrow className="h-full rounded bg-zinc-800" style={{ width: barWidth(count, share) }} />
      </div>
    </li>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export function CareerMarket({
  market,
  label,
  backHref,
}: {
  market: CareerMarketData;
  label: string;
  /** Si se está explorando otra carrera, link para volver al puesto de la pestaña. */
  backHref?: string;
}) {
  const { total } = market;
  const ago = updatedAgo(market);
  const headingId = "career-market-heading";

  return (
    <section
      aria-labelledby={headingId}
      data-testid="career-market"
      className="flex min-w-0 flex-col gap-4 rounded-md border border-sky-200 p-3 text-sm"
    >
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="font-semibold">
            Mercado de {label}
          </h2>
          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex min-h-11 items-center text-xs text-zinc-800 underline"
            >
              Volver a mi puesto
            </Link>
          ) : null}
        </div>
        {total > 0 ? (
          <p className="break-words text-xs text-zinc-600">
            {NF.format(total)} {plural(total, "oferta activa", "ofertas activas")} de fuentes
            públicas en los últimos 30 días
            {ago.text ? ` · datos del pool actualizados ${ago.text}` : ""}
          </p>
        ) : null}
        {ago.stale ? (
          <p role="note" className="mt-1 text-xs text-amber-800">
            El pool no se actualiza hace más de dos días.
          </p>
        ) : null}
      </div>

      {total === 0 ? (
        <p className="text-xs text-zinc-600">
          Todavía no hay ofertas de {label} en el pool. Probá con otra carrera.
        </p>
      ) : (
        <>
          {market.smallSample ? (
            <p role="note" className="text-xs text-amber-800">
              Muestra chica: tomalo como orientación.
            </p>
          ) : null}

          <Block title="Skills más pedidas">
            <p aria-hidden="true" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 rounded bg-zinc-800" /> Excluyente
              </span>
              <span className="flex items-center gap-1">
                <span className={`inline-block h-2 w-4 rounded ${STRIPES}`} /> Deseable
              </span>
            </p>
            <ul className="flex flex-col gap-2">
              {market.skills.map((skill) => {
                const share = pct(skill.jobs, total);
                const parts = [
                  skill.must > 0 ? `${NF.format(skill.must)} excluyente` : null,
                  skill.nice > 0 ? `${NF.format(skill.nice)} deseable` : null,
                ].filter((p): p is string => p !== null);
                return (
                  <li key={skill.slug} className="flex min-w-0 flex-col gap-1">
                    <span className="break-words text-xs text-zinc-800">
                      {skill.name} · {NF.format(skill.jobs)} de {NF.format(total)} ofertas ({share}{" "}
                      %){parts.length ? ` · ${parts.join(", ")}` : ""}
                    </span>
                    <div aria-hidden="true" className={TRACK}>
                      <BarGrow
                        className="flex h-full"
                        style={{ width: barWidth(skill.jobs, Math.min(100, share)) }}
                      >
                        <div className="h-full bg-zinc-800" style={{ flexGrow: skill.must }} />
                        <div className={`h-full ${STRIPES}`} style={{ flexGrow: skill.nice }} />
                      </BarGrow>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Block>

          <Block title="Inglés y seniority">
            <div className="flex min-w-0 flex-col gap-2">
              <h4 className="text-xs font-semibold">Seniority</h4>
              <ul className="flex flex-col gap-2">
                {SENIORITY_LABELS.map(([key, text]) => (
                  <SimpleRow
                    key={key}
                    label={text}
                    count={market.seniority.counts[key]}
                    total={total}
                  />
                ))}
              </ul>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h4 className="text-xs font-semibold">
                Inglés
                {market.english.estimated ? (
                  <span className="ml-2 rounded border border-zinc-300 px-1 font-normal text-zinc-700">
                    estimado
                  </span>
                ) : null}
              </h4>
              <p className="break-words text-xs text-zinc-800">
                {pct(market.english.asks, total)} % pide inglés ({NF.format(market.english.asks)} de{" "}
                {NF.format(total)} ofertas)
              </p>
              {market.english.asks > 0 ? (
                <>
                  <p className="text-xs text-zinc-600">
                    Nivel pedido, sobre las {NF.format(market.english.asks)} ofertas que piden
                    inglés
                  </p>
                  <ul className="flex flex-col gap-2">
                    {ENGLISH_LABELS.map(([key, text]) => (
                      <SimpleRow
                        key={key}
                        label={text}
                        count={market.english.levels[key]}
                        total={market.english.asks}
                      />
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-zinc-600">Ninguna oferta pide inglés explícitamente.</p>
              )}
              <p className="text-xs text-zinc-600">
                Avisos escritos en inglés: {NF.format(market.english.writtenInEnglish)}
              </p>
              <p className="text-xs text-zinc-600">
                Ofertas en español: {NF.format(market.english.writtenInSpanish)}
              </p>
              {market.english.estimated ? (
                <p role="note" className="text-xs text-zinc-600">
                  Se detecta leyendo el texto del aviso, sin inteligencia artificial; puede fallar.
                </p>
              ) : null}
            </div>
          </Block>

          <Block title="Sueldos publicados">
            <CareerSalary salary={market.salary} variant="full" testId="market-salary" />
          </Block>

          <Block title="Volumen y movimiento">
            <p className="text-xs text-zinc-800">
              Activas: {NF.format(market.volume.active)} · nuevas en las últimas 24 h:{" "}
              {NF.format(market.volume.new24h)}
            </p>
            <ul className="flex flex-col gap-2">
              {MODALITY_LABELS.map(([key, text]) => (
                <SimpleRow
                  key={key}
                  label={text}
                  count={market.volume.modality[key]}
                  total={total}
                />
              ))}
            </ul>
            <div className="text-xs text-zinc-800">
              <p>Se puede postular desde Argentina:</p>
              <ul>
                <li>Sí: {pct(market.volume.fromArgentina.acepta, total)} %</li>
                <li>No: {pct(market.volume.fromArgentina.no_acepta, total)} %</li>
                <li>No dice: {pct(market.volume.fromArgentina.no_dice, total)} %</li>
              </ul>
            </div>
            {market.volume.sources.length ? (
              <div className="text-xs text-zinc-600">
                <p>Fuentes:</p>
                <ul className="flex flex-wrap gap-x-3">
                  {market.volume.sources.map((x) => (
                    <li key={x.name} className="break-words">
                      {x.name} ({NF.format(x.jobs)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Block>
        </>
      )}
    </section>
  );
}
