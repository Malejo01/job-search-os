import {
  MIN_SALARY_SAMPLE,
  type CareerMarket,
  type SalarySegment,
  type SalarySummary,
} from "@job-search-os/pipeline";

/**
 * Sueldos de una carrera en dos segmentos (ronda 80), nunca una cifra mezclada: LatAm (ofertas que
 * aceptan Argentina de forma explícita) e internacional (el resto, que paga en escala de EE.UU.).
 * Sin hooks ni estado: sirve igual como Server Component (`/market`) o dentro del selector de
 * puestos, que es de cliente. El desplegable es un `<details>` nativo, así que anda sin JS.
 */
export type CareerSalaryView = CareerMarket["salary"];

const NF = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const usd = (n: number) => `USD ${NF.format(Math.round(n))}`;
/** Regla de la casa: un conteo menor a 5 nunca se muestra como número. */
const smallCount = (n: number) => (n < 5 ? "<5" : NF.format(n));

const SENIORITY_ROWS = [
  ["junior", "Trainee/Junior"],
  ["semi", "Semi Senior"],
  ["senior", "Senior"],
  ["lead", "Lead o más"],
  ["unknown", "No dice"],
] as const;

const SEGMENTS = [
  ["latam", "Ofertas abiertas a Argentina / LatAm"],
  ["international", "Ofertas internacionales"],
] as const;

const NOTE =
  "Basado en ofertas publicadas en los últimos 30 días. Las internacionales suelen pagar en escala de EE.UU. Típico = la mitad de las ofertas paga más y la otra mitad menos.";

/** "típico USD X/mes · N ofertas con sueldo", o null si la muestra no alcanza. */
function typicalText(s: SalarySummary): string | null {
  if (!s.enough || s.median === null) return null;
  return `típico ${usd(s.median)}/mes · ${NF.format(s.informed)} ofertas con sueldo`;
}

function range(s: SalarySummary): string | null {
  if (!s.enough || s.p25 === null || s.p75 === null) return null;
  return `entre ${usd(s.p25)} y ${usd(s.p75)} por mes · ${NF.format(s.informed)} ofertas con sueldo`;
}

/** Por qué no hay números: ninguna oferta con sueldo, o menos de las que hacen falta. */
function fewText(s: SalarySummary): string {
  if (s.informed === 0) return "Ninguna oferta publica sueldo todavía";
  return `Pocos datos todavía: ${smallCount(s.informed)} de ${MIN_SALARY_SAMPLE} ofertas con sueldo publicado`;
}

function SegmentBlock({
  title,
  segment,
  asHeading,
}: {
  title: string;
  segment: SalarySegment;
  asHeading: boolean;
}) {
  const main = range(segment);
  const rows = SENIORITY_ROWS.filter(([key]) => segment.bySeniority[key].total > 0);
  const titleClass = "text-xs font-semibold text-fg";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {asHeading ? <h4 className={titleClass}>{title}</h4> : <p className={titleClass}>{title}</p>}
      <p className="break-words text-xs text-fg">
        {main ? `La mitad paga ${main}` : `${fewText(segment)}.`}
      </p>
      {main && rows.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-fg-muted">
          {rows.map(([key, label]) => {
            const cell = segment.bySeniority[key];
            return (
              <li key={key} className="break-words">
                {label}: {range(cell) ?? `pocos datos (${smallCount(cell.informed)})`}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function CareerSalary({
  salary,
  variant = "compact",
  testId = "career-salary",
  label,
}: {
  salary: CareerSalaryView;
  /** `compact`: línea corta más `<details>`. `full`: los dos segmentos a la vista. */
  variant?: "compact" | "full";
  testId?: string;
  /** Nombre del puesto: lo lee el lector de pantalla después de «Ver sueldos». */
  label?: string;
}) {
  const asHeading = variant === "full";
  const body = (
    <div className="flex min-w-0 flex-col gap-2">
      {SEGMENTS.map(([key, title]) => (
        <SegmentBlock key={key} title={title} segment={salary[key]} asHeading={asHeading} />
      ))}
      <p className="text-xs text-fg-subtle">{NOTE}</p>
    </div>
  );

  if (variant === "full") {
    return (
      <div data-testid={testId} className="min-w-0">
        {body}
      </div>
    );
  }

  const line = typicalText(salary.latam);
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-1 text-sm text-fg-muted">
      <p className="break-words" data-testid={`${testId}-line`}>
        LatAm: {line ?? fewText(salary.latam)}
      </p>
      <details className="group min-w-0">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-fg underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Ver sueldos
          {label ? <span className="sr-only"> de {label}</span> : null}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 group-open:rotate-180"
          >
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
          </svg>
        </summary>
        <div className="pb-2">{body}</div>
      </details>
    </div>
  );
}
