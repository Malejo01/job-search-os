import { specialtiesFor, specialtyIdsForTitle } from "./specialties";
import { toRoleKey, type RoleKey } from "./self-assessment";

/**
 * Áreas de especialidad que la persona eligió (C3-3), lo que se guarda en `profiles.target_specialties`.
 * Puro: valida y normaliza; nunca confía en lo que llega (un formulario armado a mano, un valor viejo
 * de la base).
 *
 * Forma: `{ [carrera]: [id de área, …] }`, solo para las carreras que la persona **acotó**. Una carrera
 * sin entrada, o toda la columna en `null`, es «Todas las áreas»: se busca en toda la carrera. Guardar
 * solo lo que restringe hace que `null` sea el valor por defecto y que marcar todos los chips sea lo
 * mismo que no marcar ninguno.
 *
 * Todavía no filtra ningún aviso: el pool y el prefiltro no lo leen. `jobMatchesSpecialties` es la
 * referencia de cómo se aplicaría (ver el PR de C3-3).
 */
export type TargetSpecialties = Partial<Record<RoleKey, string[]>>;

/** Tope de entradas «carrera:área» que se leen de un envío: 20 carreras × ~11 áreas caben de sobra. */
export const MAX_SPECIALTY_ENTRIES = 300;

/**
 * Lee los valores `carrera:área` que manda el formulario (una entrada oculta por chip marcado). Agrupa
 * por carrera sin repetir y descarta lo que no tiene esa forma. No valida contra el catálogo: eso es
 * `normalizeTargetSpecialties`.
 */
export function parseSpecialtyEntries(values: unknown): Record<string, string[]> {
  const grouped = new Map<string, string[]>();
  if (!Array.isArray(values)) return {};
  let count = 0;
  for (const value of values) {
    if (count >= MAX_SPECIALTY_ENTRIES) break;
    if (typeof value !== "string") continue;
    const parts = value.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    const [role, id] = parts as [string, string];
    const list = grouped.get(role) ?? [];
    if (list.includes(id)) continue;
    list.push(id);
    grouped.set(role, list);
    count += 1;
  }
  return Object.fromEntries(grouped);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lo que se guarda: solo las carreras que la persona eligió (`roles`) y que tienen áreas, solo áreas que
 * existen en el catálogo (en su orden) y solo si **acotan**. Todas marcadas, ninguna válida o un valor
 * que no es un objeto dan «todas las áreas»; si ninguna carrera se acota, devuelve `null`.
 */
export function normalizeTargetSpecialties(
  input: unknown,
  roles: readonly string[],
): TargetSpecialties | null {
  if (!isRecord(input)) return null;
  const entries: [RoleKey, string[]][] = [];
  for (const raw of roles) {
    const role = toRoleKey(raw);
    if (!role || !Object.prototype.hasOwnProperty.call(input, role)) continue;
    if (entries.some(([r]) => r === role)) continue;
    const catalog = specialtiesFor(role).map((c) => c.id);
    const asked = input[role];
    if (catalog.length === 0 || !Array.isArray(asked)) continue;
    const wanted = new Set(asked.filter((v): v is string => typeof v === "string"));
    const chosen = catalog.filter((id) => wanted.has(id));
    if (chosen.length === 0 || chosen.length === catalog.length) continue;
    entries.push([role, chosen]);
  }
  return entries.length > 0 ? (Object.fromEntries(entries) as TargetSpecialties) : null;
}

/** Las áreas guardadas de una carrera, o `null` si busca en todas (lo que la pantalla marca de entrada). */
export function selectedSpecialtyIds(saved: unknown, role: RoleKey): string[] | null {
  return normalizeTargetSpecialties(saved, [role])?.[role] ?? null;
}

/**
 * ¿Este aviso de la carrera entra en las áreas que eligió la persona? Sin selección para la carrera,
 * sí. Un título que ningún área nombra tampoco se esconde (solo se puede acotar por lo que el título
 * dice). Con selección, entra si nombra al menos un área elegida.
 */
export function jobMatchesSpecialties(title: string, role: RoleKey, saved: unknown): boolean {
  const selected = selectedSpecialtyIds(saved, role);
  if (!selected) return true;
  const named = specialtyIdsForTitle(title, role);
  if (named.length === 0) return true;
  return named.some((id) => selected.includes(id));
}
