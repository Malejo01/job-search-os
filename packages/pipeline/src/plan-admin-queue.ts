/**
 * Cola de altas de `/settings/planes` (R22-02). Puro: valida el motivo de un rechazo y filtra la lista de
 * planes por búsqueda de email y por estado. La fecha viene de afuera (`now`). Nada de esto llama a un
 * modelo ni toca la base: la decisión de activar o rechazar la toma la persona admin.
 */
import { err, ok, type Result } from "./result";

/** Largo máximo del motivo de rechazo (el CHECK de la base usa el mismo número). */
export const REJECT_REASON_MAX_LENGTH = 200;

/** Motivo corto: 1 a 200 caracteres, ya recortado. Cualquier otra cosa falla cerrada. */
export function parseRejectReason(raw: unknown): Result<string, "motivo"> {
  if (typeof raw !== "string") return err("motivo");
  const value = raw.trim();
  if (value.length < 1 || value.length > REJECT_REASON_MAX_LENGTH) return err("motivo");
  return ok(value);
}

export const PLAN_LIST_FILTERS = ["vencen_7", "vencidos", "pendientes"] as const;
export type PlanListFilter = (typeof PLAN_LIST_FILTERS)[number];

/** Lee el filtro de la URL: uno de los tres, o `null` (sin filtro) ante cualquier otro valor. */
export function parsePlanFilter(raw: unknown): PlanListFilter | null {
  return (PLAN_LIST_FILTERS as readonly unknown[]).includes(raw) ? (raw as PlanListFilter) : null;
}

export type PlanListRow = {
  email: string;
  plan: string;
  planSource: string | null;
  planUntil: Date | null;
};

const DAY_MS = 86_400_000;

/**
 * Filtra las filas de la lista de planes. `q` busca dentro del email (sin mayúsculas). «Vencen en 7 días»:
 * la fecha cae entre ahora y 7 días; «Vencidos»: ya pasó; «Pendientes»: tienen un aviso pendiente. Las filas
 * sin fecha no entran en los dos primeros. Conserva el orden de entrada.
 */
export function filterPlanRows<T extends PlanListRow>(
  rows: readonly T[],
  opts: {
    q: string;
    filter: PlanListFilter | null;
    now: Date;
    pendingEmails: ReadonlySet<string>;
  },
): T[] {
  const q = opts.q.trim().toLowerCase();
  const now = opts.now.getTime();
  const pending = new Set([...opts.pendingEmails].map((e) => e.toLowerCase()));
  return rows.filter((r) => {
    const email = r.email.toLowerCase();
    if (q && !email.includes(q)) return false;
    const until = r.planUntil?.getTime() ?? null;
    switch (opts.filter) {
      case "vencen_7":
        return until !== null && until >= now && until <= now + 7 * DAY_MS;
      case "vencidos":
        return until !== null && until < now;
      case "pendientes":
        return pending.has(email);
      default:
        return true;
    }
  });
}
