/**
 * Diferencia entre las skills guardadas de cada aviso del pool y las que da el detector actual
 * (R11-9). Puro: lo usa `skills:extract --pool` para mostrar cuántas skills espurias se van a
 * sacar antes de escribir nada.
 */
export type PoolSkillsDiff = {
  /** Avisos con alguna diferencia (los únicos que se reescriben). */
  changedJobs: number;
  /** Cuántos avisos pierden cada skill. */
  removedBySlug: Record<string, number>;
  /** Cuántos avisos ganan cada skill. */
  addedBySlug: Record<string, number>;
};

export function diffPoolSkills(
  before: ReadonlyMap<string, ReadonlySet<string>>,
  after: ReadonlyMap<string, readonly string[]>,
): { diff: PoolSkillsDiff; changedIds: string[] } {
  const removedBySlug: Record<string, number> = {};
  const addedBySlug: Record<string, number> = {};
  const changedIds: string[] = [];
  for (const [id, slugs] of after) {
    const old = before.get(id) ?? new Set<string>();
    const next = new Set(slugs);
    let changed = false;
    for (const slug of old) {
      if (!next.has(slug)) {
        removedBySlug[slug] = (removedBySlug[slug] ?? 0) + 1;
        changed = true;
      }
    }
    for (const slug of next) {
      if (!old.has(slug)) {
        addedBySlug[slug] = (addedBySlug[slug] ?? 0) + 1;
        changed = true;
      }
    }
    if (changed) changedIds.push(id);
  }
  return { diff: { changedJobs: changedIds.length, removedBySlug, addedBySlug }, changedIds };
}
