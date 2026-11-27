import { formatSalaryAmount, type MarketMinimal } from "@job-search-os/pipeline";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses, cardClasses } from "@/components/ui";
import { MERCADO_TEXTOS as T } from "@/lib/textos-rediseno";
import { BarGrow } from "./bar-grow";

/**
 * `/market` mínimo (R34-03). Server Component: una sola página, cuatro bloques y cada uno termina en una
 * acción. Cada barra va con su número en texto (la barra es decoración, `aria-hidden`). Con menos de 10
 * avisos no hay gráfico: solo los números y el aviso de que todavía hay pocos datos.
 */
const NF = new Intl.NumberFormat("es-AR");
const TRACK =
  "h-2 w-full overflow-hidden rounded-badge bg-surface-muted ring-1 ring-inset ring-line";

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const ofertas = (n: number) => (n === 1 ? "oferta" : "ofertas");

/** «2026-11-27T12:00:00Z» -> «27/11/2026» */
const dateOf = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function Block({
  title,
  testId,
  market,
  action,
  children,
}: {
  title: string;
  testId: string;
  market: MarketMinimal;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className={cardClasses({ padding: "md", className: "flex min-w-0 flex-col gap-3" })}
    >
      <h2 className="text-base font-bold">{title}</h2>
      {children}
      <p className="text-sm text-fg-muted">
        {fill(T.fuente, {
          n: NF.format(market.vigentes),
          avisos: market.vigentes === 1 ? T.avisoUno : T.avisoVarios,
          fecha: dateOf(market.asOf),
        })}
      </p>
      <div>{action}</div>
    </section>
  );
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={buttonClasses({ variant: "secondary", className: "w-full sm:w-auto" })}
    >
      {children}
    </Link>
  );
}

function BarRow({ label, count, total }: { label: string; count: number; total: number }) {
  const share = pct(count, total);
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="break-words text-sm text-fg">{label}</span>
      <div aria-hidden="true" className={TRACK}>
        <BarGrow
          className="h-full rounded-badge bg-fg"
          style={{ width: count > 0 ? `max(${share}%, 4px)` : "0px" }}
        />
      </div>
    </li>
  );
}

export function MarketMinimalView({ market, label }: { market: MarketMinimal; label: string }) {
  const { vigentes } = market;

  if (vigentes === 0) {
    return (
      <p
        data-testid="market-vacio"
        className="rounded-container bg-surface px-6 py-8 text-center text-sm text-fg-muted"
      >
        {fill(T.vacio, { carrera: label })}
      </p>
    );
  }

  const chart = market.enoughForChart;
  const modalityRows = [
    ["remoto", T.modalidad.remoto],
    ["hibrido", T.modalidad.hibrido],
    ["presencial", T.modalidad.presencial],
    ["desconocida", T.modalidad.desconocida],
  ] as const;
  const originRows = [
    ["tomable", T.modalidad.tomable],
    ["noDice", T.modalidad.noDice],
    ["otros", T.modalidad.otros],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <Block
        title={T.ofertas.titulo}
        testId="market-ofertas"
        market={market}
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <ActionLink href="/jobs?pais=1">{T.ofertas.verOfertas}</ActionLink>
            <ActionLink href="/jobs?pais=1&inicio=1">{T.ofertas.verParaEmpezar}</ActionLink>
          </div>
        }
      >
        <ul className="flex flex-col gap-1 text-base">
          <li>{fill(T.ofertas.hay, { n: NF.format(vigentes), ofertas: ofertas(vigentes) })}</li>
          <li>{fill(T.ofertas.podesTomar, { n: NF.format(market.tomables) })}</li>
          <li>{fill(T.ofertas.paraEmpezar, { n: NF.format(market.paraEmpezar) })}</li>
        </ul>
        <p className="text-sm text-fg-muted">{T.ofertas.nota}</p>
      </Block>

      {chart ? null : (
        <p role="note" data-testid="market-pocos" className="text-sm text-fg-muted">
          {T.pocos}
        </p>
      )}

      <Block
        title={T.habilidades.titulo}
        testId="market-habilidades"
        market={market}
        action={<ActionLink href="/settings/skills">{T.habilidades.cargar}</ActionLink>}
      >
        {!chart ? null : market.skills.length === 0 ? (
          <p className="text-sm text-fg-muted">{T.habilidades.sinDatos}</p>
        ) : (
          <>
            <p className="text-sm text-fg">
              {fill(T.habilidades.resumen, {
                n: market.skillsHave,
                total: market.skills.length,
              })}
            </p>
            <ul className="flex flex-col gap-3">
              {market.skills.map((skill) => (
                <li key={skill.slug} className="flex min-w-0 flex-col gap-1">
                  <span className="break-words text-sm text-fg">
                    {fill(T.habilidades.fila, {
                      nombre: skill.name,
                      n: NF.format(skill.jobs),
                      total: NF.format(vigentes),
                      pct: pct(skill.jobs, vigentes),
                    })}
                    {" · "}
                    <strong>{skill.have ? T.habilidades.laTenes : T.habilidades.noLaTenes}</strong>
                  </span>
                  <div aria-hidden="true" className={TRACK}>
                    <BarGrow
                      className="h-full rounded-badge bg-fg"
                      style={{ width: `max(${Math.min(100, pct(skill.jobs, vigentes))}%, 4px)` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>

      <Block
        title={T.modalidad.titulo}
        testId="market-modalidad"
        market={market}
        action={<ActionLink href="/jobs?modalidad=remoto">{T.modalidad.ver}</ActionLink>}
      >
        {!chart ? null : (
          <>
            <ul className="flex flex-col gap-3">
              {modalityRows.map(([key, text]) => (
                <BarRow
                  key={key}
                  count={market.modality[key]}
                  total={vigentes}
                  label={fill(T.modalidad.fila, {
                    etiqueta: text,
                    n: NF.format(market.modality[key]),
                    ofertas: ofertas(market.modality[key]),
                    pct: pct(market.modality[key], vigentes),
                  })}
                />
              ))}
            </ul>
            <h3 className="text-sm font-bold">{T.modalidad.desdeTitulo}</h3>
            <ul className="flex flex-col gap-3">
              {originRows.map(([key, text]) => (
                <BarRow
                  key={key}
                  count={market.origin[key]}
                  total={vigentes}
                  label={fill(T.modalidad.fila, {
                    etiqueta: text,
                    n: NF.format(market.origin[key]),
                    ofertas: ofertas(market.origin[key]),
                    pct: pct(market.origin[key], vigentes),
                  })}
                />
              ))}
            </ul>
          </>
        )}
      </Block>

      <Block
        title={T.sueldos.titulo}
        testId="market-sueldos"
        market={market}
        action={<ActionLink href="/jobs">{T.sueldos.ver}</ActionLink>}
      >
        {!chart ? null : market.salary.withSalary === 0 ? (
          <p className="text-sm text-fg-muted">{T.sueldos.ninguno}</p>
        ) : (
          <>
            <p className="text-sm text-fg-muted">{T.sueldos.explicacion}</p>
            {market.salary.groups.length === 0 ? (
              <p className="text-sm text-fg">{T.sueldos.pocos}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {market.salary.groups.map((g) => (
                  <li key={g.currency} className="flex flex-col gap-1 text-sm text-fg">
                    <span>
                      {fill(T.sueldos.rango, {
                        moneda: g.currency,
                        desde: formatSalaryAmount(g.p25, g.currency),
                        hasta: formatSalaryAmount(g.p75, g.currency),
                        mediana: formatSalaryAmount(g.median, g.currency),
                      })}
                    </span>
                    <span className="text-fg-muted">
                      {fill(T.sueldos.casos, {
                        n: NF.format(g.informed),
                        avisos: g.informed === 1 ? T.avisoUno : T.avisoVarios,
                        moneda: g.currency,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {market.salary.hiddenCurrencies > 0 && market.salary.groups.length > 0 ? (
              <p className="text-sm text-fg-muted">{T.sueldos.ocultas}</p>
            ) : null}
          </>
        )}
      </Block>
    </div>
  );
}
