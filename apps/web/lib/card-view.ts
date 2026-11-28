import {
  formatSalaryOriginal,
  type CardRequirement,
  type SalaryOriginal,
} from "@job-search-os/pipeline";
import { LISTADO_TEXTOS, llenarTexto } from "./textos-rediseno";

/**
 * Vista de la tarjeta del listado (R30-04): solo formato, sin consultas. Lo que la tarjeta dice sobre
 * requisitos sale de la tabla de la evaluación (`cardRequirements`); acá se arma el texto.
 */

const PERIODS: Record<string, string> = {
  mensual: "por mes",
  anual: "por año",
  hora: "por hora",
};

/** 41250 → «41.250» (separador de miles fijo: no depende del ICU del entorno). */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Sueldo solo si el aviso lo publica. Con el sueldo original (R32-08) dice lo que el aviso publica, en su
 * moneda: «$ 1.200.000 a $ 1.500.000 por mes (ARS)». Sin él (lo guardado antes), la línea de siempre en
 * dólares: «USD 350–870 por mes». Sin periodo conocido, no se inventa.
 */
export function salaryLine(
  min: number | null | undefined,
  max: number | null | undefined,
  period: string | null | undefined,
  original?: SalaryOriginal | null,
): string | null {
  if (original) return formatSalaryOriginal(original);
  const lo = min && min > 0 ? min : null;
  const hi = max && max > 0 ? max : null;
  if (lo === null && hi === null) return null;
  const range =
    lo !== null && hi !== null && lo !== hi
      ? `${thousands(Math.min(lo, hi))}–${thousands(Math.max(lo, hi))}`
      : thousands((hi ?? lo) as number);
  const per = period ? PERIODS[period.trim().toLowerCase()] : undefined;
  return `USD ${range}${per ? ` ${per}` : ""}`;
}

/** «Residir en EE. UU.» → «residir en EE. UU.»; las siglas y nombres propios (segunda letra en mayúscula) quedan. */
export function requirementPhrase(pide: string): string {
  const t = pide.trim();
  if (t.length < 2) return t;
  const [first, second] = [t[0]!, t[1]!];
  const isSigla = second === second.toUpperCase() && second !== second.toLowerCase();
  return isSigla ? t : first.toLowerCase() + t.slice(1);
}

export function noCoincideLine(req: CardRequirement): string {
  return llenarTexto(LISTADO_TEXTOS.tarjeta.noCoincide, { requisito: requirementPhrase(req.pide) });
}

export function sinConfirmarLine(items: readonly CardRequirement[]): string | null {
  if (!items.length) return null;
  return llenarTexto(LISTADO_TEXTOS.tarjeta.sinConfirmar, {
    lista: items.map((i) => requirementPhrase(i.pide)).join(", "),
  });
}
