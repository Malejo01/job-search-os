import { isRoleKey, ROLE_KEYS, type RoleKey } from "./self-assessment";

/**
 * Varios puestos con tope por plan (ronda 45, ADR-016). Puro: el env y el tope del perfil los lee
 * la app y los pasa acá; la validación del servidor es la que manda, la UI solo ayuda.
 */

/** Tope del plan gratis cuando `TARGET_ROLES_FREE_LIMIT` falta o es inválido. */
export const TARGET_ROLES_DEFAULT_LIMIT = 2;

function validLimit(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= ROLE_KEYS.length;
}

/**
 * Tope de puestos de la persona: `max_target_roles` del perfil (si no es null y válido) pisa al
 * env `TARGET_ROLES_FREE_LIMIT`; el env es un entero de 1 a la cantidad de puestos (16), inválido = 2.
 */
export function targetRolesLimit(
  env: Record<string, string | undefined>,
  profileMax: number | null,
): number {
  if (profileMax !== null && validLimit(profileMax)) return profileMax;
  const raw = env.TARGET_ROLES_FREE_LIMIT?.trim() ?? "";
  if (/^\d+$/.test(raw) && validLimit(Number(raw))) return Number(raw);
  return TARGET_ROLES_DEFAULT_LIMIT;
}

export type TargetRolesParse = { ok: true; roles: RoleKey[] } | { ok: false; field: "targetRoles" };

/**
 * Valida la selección: solo claves de `ROLE_KEYS` (sin espacios sobrantes), sin repetir y entre 1
 * y `limit`. Un valor inválido o repetido falla en vez de descartarse en silencio. Conserva el
 * orden de entrada: el primero es el puesto principal.
 */
export function parseTargetRoles(values: readonly string[], limit: number): TargetRolesParse {
  const roles: RoleKey[] = [];
  for (const v of values) {
    if (!isRoleKey(v) || roles.includes(v)) return { ok: false, field: "targetRoles" };
    roles.push(v);
  }
  if (roles.length < 1 || roles.length > limit) return { ok: false, field: "targetRoles" };
  return { ok: true, roles };
}
