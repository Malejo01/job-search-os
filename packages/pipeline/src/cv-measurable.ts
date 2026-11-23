/**
 * Logros medibles, por código (R20-02). Puro: sin modelo, red ni fecha. Mira las viñetas del CV y cuenta
 * cuántas traen un resultado medible.
 *
 * Qué cuenta como resultado (sobre el texto normalizado: minúsculas y sin acentos):
 * - porcentaje (`18%`, `20 por ciento`);
 * - moneda (`$`, `EUR 2.500`, `800 mil pesos`) y magnitudes (`10k`, `1,5M`, `3 millones`);
 * - tiempo en días, horas, minutos, segundos o semanas (`5 días`, `30 min`);
 * - cantidad de personas o de cosas (`equipo de 6`, `120 clientes`, `cinco desarrolladores`);
 * - «de X a Y» con números que no sean años (`de 40 a 80`);
 * - multiplicadores (`3x`, `x2`) y «la mitad», «el doble», «duplicar».
 * Qué NO cuenta: un número suelto. Un año (2021), un período (2020 - 2022, «de 2020 a 2022»), una versión
 * (Java 8, versión 2.1), una fecha o una duración de empleo («3 años») no son un logro. Límite conocido:
 * «de 9 a 18» (un horario) cuenta como «de X a Y».
 *
 * Puntaje (0 a 10) = viñetas con resultado / meta, con piso y tope por cantidad: la meta es la mitad de las
 * viñetas, nunca menos de 3 (una sola viñeta no alcanza para 10) ni más de 6 (no se pide más que eso).
 * Consejo: cita la primera viñeta real sin resultado, tal cual, para que la persona le agregue el número;
 * no se reescribe.
 * Entrada acotada: hasta `MAX_BULLETS` viñetas de hasta `MAX_BULLET_CHARS` caracteres.
 */

/** Meta de viñetas con resultado: entre estos dos valores. */
export const CV_MEASURABLE_TARGET_MIN = 3;
export const CV_MEASURABLE_TARGET_MAX = 6;

const MAX_BULLETS = 200;
const MAX_BULLET_CHARS = 1_000;
const EXAMPLE_MAX_CHARS = 120;
const EXAMPLE_MIN_WORDS = 4;

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const NUMBER_WORDS =
  "dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|quince|veinte|treinta|cuarenta|cincuenta|cien|cientos|miles|decenas";
const NUM = `(?:\\d[\\d.,]*\\+?|${NUMBER_WORDS})`;
const COUNT_NOUNS =
  "personas|integrantes|miembros|colaboradores|empleados|desarrolladores|analistas|vendedores|alumnos|estudiantes|clientes|usuarios|proveedores|sucursales|proyectos|tickets|pedidos|ventas|reportes|casos|llamadas|consultas|cuentas|unidades|productos|sitios|equipos|ordenes|facturas|registros|paises|tiendas|capacitaciones|auditorias|entregas|leads|contratos";
const ADJ = "nuevos|nuevas|activos|activas|internos|externos|mensuales|semanales|diarios|diarias";

const PATTERNS: RegExp[] = [
  // porcentaje
  /\d\s*%|\bpor\s*ciento\b|\d\s*(?:pp|puntos porcentuales)\b/,
  // moneda y magnitudes
  /[$€£]\s*\d|\b(?:usd|ars|eur|clp|mxn|cop)\s*\d|\d[\d.,]*\s*(?:usd|eur|euros?|dolares?|pesos|reales)\b/,
  /\d(?:k|m|mm)\b|\d\s*(?:millones?|mil)\b/,
  // tiempo (años y meses no: son duración de empleo o de estudio)
  /\b\d+(?:[.,]\d+)?\s*(?:dias?|horas?|hs|hrs|minutos?|min|segundos?|seg|semanas?)\b/,
  // cantidad de personas o de cosas
  new RegExp(`\\b${NUM}\\s+(?:(?:${ADJ})\\s+)?(?:${COUNT_NOUNS})\\b`),
  /\b(?:equipo|grupo|area|cargo)\s+de\s+\d/,
  /\ba cargo de\s+\d/,
  // multiplicadores y fracciones
  /\b\d+(?:[.,]\d+)?\s*[x×](?![a-z0-9])|(?<![a-z0-9])[x×]\s*\d/,
  /\bla mitad\b|\bel doble\b|\bel triple\b/,
  // verbos: «dupliqué», «triplicamos», «duplicó» (no «base duplicada»)
  /\b(?:dupliqu|tripliqu|cuadrupliqu)(?:e|en|emos)\b|\b(?:duplic|triplic|cuadruplic)(?:o|amos|aron)\b/,
];

const FROM_TO = /\bde\s+(\$?\d[\d.,]*)\s*(?:%|[a-z]+)?\s+a(?:l)?\s+(\$?\d[\d.,]*)/g;
const YEAR = /^(?:19|20)\d{2}$/;

/** `true` si la viñeta trae un resultado medible (ver las reglas arriba). */
export function hasMeasurableResult(bullet: string): boolean {
  const t = normalize(bullet.slice(0, MAX_BULLET_CHARS));
  if (PATTERNS.some((p) => p.test(t))) return true;
  for (const m of t.matchAll(FROM_TO)) {
    const x = m[1]!.replace(/[.,]+$/, "");
    const y = m[2]!.replace(/[.,]+$/, "");
    if (!YEAR.test(x) && !YEAR.test(y)) return true;
  }
  return false;
}

export type CvMeasurableResult = {
  /** Viñetas no vacías que se miraron. */
  total: number;
  withResult: number;
  /** 0 a 10, un decimal. */
  score: number;
  /** Una viñeta real sin resultado, tal cual (recortada si es larguísima); `null` si no hay. */
  example: string | null;
};

export function analyzeCvMeasurable(bullets: readonly string[]): CvMeasurableResult {
  const clean: string[] = [];
  for (const raw of bullets.slice(0, MAX_BULLETS)) {
    const b = raw.slice(0, MAX_BULLET_CHARS).trim();
    if (b !== "") clean.push(b);
  }
  const flags = clean.map(hasMeasurableResult);
  const withResult = flags.filter(Boolean).length;
  const total = clean.length;

  const target = Math.min(
    CV_MEASURABLE_TARGET_MAX,
    Math.max(CV_MEASURABLE_TARGET_MIN, Math.ceil(total / 2)),
  );
  const score = total === 0 ? 0 : Math.round(Math.min(1, withResult / target) * 100) / 10;

  const without = clean.filter((_, i) => !flags[i]);
  const pick =
    without.find((b) => b.split(/\s+/).length >= EXAMPLE_MIN_WORDS) ?? without[0] ?? null;
  const example =
    pick === null
      ? null
      : pick.length > EXAMPLE_MAX_CHARS
        ? `${pick.slice(0, EXAMPLE_MAX_CHARS)}…`
        : pick;
  return { total, withResult, score, example };
}
