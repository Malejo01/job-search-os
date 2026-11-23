/**
 * Panel /admin, sección Personas (ADM-1). Puro: filtros y búsqueda del listado, las etiquetas de estado de
 * cada persona, los textos del historial y de los resultados de las acciones, y cómo un rol de la base
 * (`user_roles`, rls/0064) se suma a las etapas «testers» de las funciones nuevas. Sin I/O ni reloj.
 */
import { planAccess } from "./plan-access";

export const PEOPLE_PAGE_SIZE = 50;
const MAX_PAGE = 1000;
const MAX_QUERY = 120;

/** Los mismos filtros que entiende `admin_people_list` en la base, en el orden en que se muestran. */
export const PEOPLE_FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "plan_activo", label: "Con plan activo" },
  { key: "vencen_7", label: "Vencen en 7 días" },
  { key: "vencidos", label: "Plan vencido" },
  { key: "sin_plan", label: "Sin plan" },
  { key: "sin_onboarding", label: "Sin terminar el inicio" },
  { key: "testers", label: "Testers" },
  { key: "admins", label: "Admins" },
  { key: "bloqueadas", label: "Bloqueadas" },
  { key: "prueba", label: "Cuentas de prueba" },
] as const;

export type PeopleFilter = (typeof PEOPLE_FILTERS)[number]["key"];

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export function parsePeopleFilter(v: unknown): PeopleFilter {
  const x = first(v);
  return PEOPLE_FILTERS.some((f) => f.key === x) ? (x as PeopleFilter) : "todas";
}

export function parsePeoplePage(v: unknown): number {
  const x = first(v);
  if (typeof x !== "string" || !/^\d+$/.test(x)) return 1;
  const n = Number(x);
  if (n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

export function parsePeopleQuery(v: unknown): string | null {
  const x = first(v);
  if (typeof x !== "string") return null;
  const q = x.trim().slice(0, MAX_QUERY);
  return q.length > 0 ? q : null;
}

export type PersonSnapshot = {
  blockedAt: Date | null;
  isTest: boolean;
  onboarded: boolean;
  plan: string;
  planUntil: Date | null;
  planSource: string | null;
  isAdmin: boolean;
  isTester: boolean;
};

export type BadgeTone = "danger" | "warning" | "success" | "neutral" | "info";
export type PersonBadge = { key: string; label: string; tone: BadgeTone };

/** Etiquetas de estado, de la más importante a la menos: el bloqueo siempre primero. */
export function personBadges(p: PersonSnapshot, now: Date): PersonBadge[] {
  const out: PersonBadge[] = [];
  if (p.blockedAt) out.push({ key: "bloqueada", label: "Bloqueada", tone: "danger" });
  const access = planAccess({
    plan: p.plan,
    planUntil: p.planUntil,
    planSource: p.planSource,
    now,
  });
  switch (access.status) {
    case "gratis":
      out.push({ key: "gratis", label: "Sin plan", tone: "neutral" });
      break;
    case "activo":
      out.push({ key: "activo", label: "Plan activo", tone: "success" });
      break;
    case "sin_vencimiento":
      out.push({ key: "activo", label: "Plan sin vencimiento", tone: "success" });
      break;
    case "por_vencer": {
      const d = access.daysLeft ?? 0;
      out.push({
        key: "por_vencer",
        label: d <= 1 ? "Vence mañana" : `Vence en ${d} días`,
        tone: "warning",
      });
      break;
    }
    case "vencido":
      out.push({ key: "vencido", label: "Plan vencido", tone: "warning" });
      break;
  }
  if (access.becado && access.status !== "gratis") {
    out.push({ key: "becado", label: "Beca", tone: "info" });
  }
  if (!p.onboarded)
    out.push({ key: "sin_onboarding", label: "Sin terminar el inicio", tone: "neutral" });
  if (p.isAdmin) out.push({ key: "admin", label: "Admin", tone: "info" });
  if (p.isTester) out.push({ key: "tester", label: "Tester", tone: "info" });
  if (p.isTest) out.push({ key: "prueba", label: "Cuenta de prueba", tone: "neutral" });
  return out;
}

/** Textos del historial de la ficha: lo del panel y los cambios de plan (`plan_` + acción de plan_events). */
export const ADMIN_HISTORY_LABELS: Record<string, string> = {
  tester_si: "Pasó a tester",
  tester_no: "Dejó de ser tester",
  bloquear: "Cuenta bloqueada",
  desbloquear: "Cuenta desbloqueada",
  prueba_si: "Marcada como cuenta de prueba",
  prueba_no: "Ya no es cuenta de prueba",
  plan_activar: "Plan activado",
  plan_renovar: "Plan renovado",
  plan_quitar: "Plan quitado",
  plan_rechazar_aviso: "Aviso de pago rechazado",
  plan_marca: "Cambio de precio especial",
};

const SOURCE_LABEL: Record<string, string> = { pago: "pago", beca: "beca" };

export function historyLabel(action: string, source: string | null): string {
  const label = ADMIN_HISTORY_LABELS[action] ?? action;
  const s = source ? SOURCE_LABEL[source] : undefined;
  return s ? `${label} (${s})` : label;
}

export type PersonAction =
  "tester_si" | "tester_no" | "bloquear" | "desbloquear" | "prueba_si" | "prueba_no";

const OK_MESSAGE: Record<PersonAction, string> = {
  tester_si: "Ahora es tester: ve las funciones que están en prueba.",
  tester_no: "Ya no es tester.",
  bloquear: "Cuenta bloqueada. Sus sesiones abiertas se cerraron.",
  desbloquear: "Cuenta desbloqueada. Ya puede volver a entrar.",
  prueba_si: "Marcada como cuenta de prueba: no cuenta en las métricas.",
  prueba_no: "Ya no es cuenta de prueba.",
};

/** Traduce lo que devuelve la base (`ok`, `sin_cambio`, `no_existe`, `propia`, `es_admin`) a un mensaje. */
export function personActionMessage(
  action: PersonAction,
  result: string,
): { ok: boolean; message: string } {
  switch (result) {
    case "ok":
      return { ok: true, message: OK_MESSAGE[action] };
    case "sin_cambio":
      return { ok: true, message: "No hubo cambios: ya estaba así." };
    case "no_existe":
      return { ok: false, message: "Esa cuenta ya no existe." };
    case "propia":
      return { ok: false, message: "No podés bloquear tu propia cuenta." };
    case "es_admin":
      return {
        ok: false,
        message: "No se puede bloquear a un admin desde el panel: primero sacalo de los admins.",
      };
    default:
      return { ok: false, message: "No se pudo guardar el cambio. Probá de nuevo." };
  }
}

/** Roles que la base puede dar (el CHECK de `user_roles`). */
export type DbRole = "tester";

export function hasDbRole(roles: readonly string[] | null | undefined, role: DbRole): boolean {
  return Array.isArray(roles) && roles.includes(role);
}

/**
 * Las etapas «testers» de las funciones nuevas leen `ASSISTANT_TESTER_EMAILS`. Una persona con el rol
 * `tester` en la base se suma a esa lista solo para su propia consulta: devuelve una copia del env con su
 * email agregado. No toca `ADMIN_EMAILS`: ser tester nunca da permisos de admin.
 */
export function withDbTesters<E extends Record<string, string | undefined>>(
  env: E,
  email: string | null | undefined,
  roles: readonly string[] | null | undefined,
): E {
  if (!email || !hasDbRole(roles, "tester")) return env;
  const normalized = email.trim().toLowerCase();
  const current = (env.ASSISTANT_TESTER_EMAILS ?? "").trim();
  return {
    ...env,
    ASSISTANT_TESTER_EMAILS: current ? `${current},${normalized}` : normalized,
  };
}
