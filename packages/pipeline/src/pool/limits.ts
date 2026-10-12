/**
 * Topes de la asignación del pool (ronda 38). Puro: recibe el entorno ya leído y devuelve los
 * números. Entero entre 0 y 500; 0 apaga el tope correspondiente. Vacío o ausente → default;
 * inválido → default y el nombre de la variable en `invalid` para que el llamador lo registre.
 */
export type PoolLimits = {
  /** Ofertas asignadas al terminar el onboarding. */
  firstAssignLimit: number;
  /** De esas, cuántas se evalúan enseguida. */
  firstEvalTopN: number;
  /** Ofertas asignadas por usuario y día en el cron. */
  dailyAssignLimit: number;
  /** Evaluaciones encoladas por usuario y día en el cron. */
  dailyEvalPerUser: number;
};

export const POOL_LIMIT_DEFAULTS: PoolLimits = {
  firstAssignLimit: 30,
  firstEvalTopN: 9,
  dailyAssignLimit: 20,
  dailyEvalPerUser: 3,
};

export const POOL_LIMIT_MAX = 500;

const ENV_NAMES: readonly [keyof PoolLimits, string][] = [
  ["firstAssignLimit", "POOL_FIRST_ASSIGN_LIMIT"],
  ["firstEvalTopN", "FIRST_EVAL_TOP_N"],
  ["dailyAssignLimit", "POOL_DAILY_ASSIGN_LIMIT"],
  ["dailyEvalPerUser", "POOL_DAILY_EVAL_PER_USER"],
];

export function parsePoolLimits(env: Record<string, string | undefined>): {
  limits: PoolLimits;
  invalid: string[];
} {
  const limits: PoolLimits = { ...POOL_LIMIT_DEFAULTS };
  const invalid: string[] = [];
  for (const [key, name] of ENV_NAMES) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    // Solo dígitos decimales: nada de "1e2", "0x10", "1.5" ni signos
    const n = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
    if (Number.isInteger(n) && n >= 0 && n <= POOL_LIMIT_MAX) limits[key] = n;
    else invalid.push(name);
  }
  return { limits, invalid };
}
