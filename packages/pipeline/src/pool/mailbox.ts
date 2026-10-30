/**
 * Casillas del pool de la beta (ADR-024): `pool-<carrera>@<dominio de ingesta>`. Función pura: el
 * dominio y las carreras llegan como dato. Comparación exacta y en minúsculas, sin comodines ni
 * subdirecciones (`+`).
 */
export type PoolMailboxResult =
  | { ok: true; career: string }
  | { ok: false; reason: "not_pool" | "wrong_domain" | "unknown_career" };

const POOL_PREFIX = "pool-";

/** La dirección sola, sin nombre visible, en minúsculas. */
function bareAddress(to: string): string {
  return (/<([^>]+)>/.exec(to)?.[1] ?? to).trim().toLowerCase();
}

/** ¿Es una casilla `pool-*`? No valida carrera ni dominio: sirve para desviar antes de buscar usuario. */
export function isPoolMailboxAddress(to: string): boolean {
  return bareAddress(to).startsWith(POOL_PREFIX);
}

export function parsePoolMailbox(
  to: string,
  opts: { ingestDomain: string; careers: readonly string[] },
): PoolMailboxResult {
  const addr = bareAddress(to);
  const parts = addr.split("@");
  if (parts.length !== 2) return { ok: false, reason: "not_pool" };
  const [local, domain] = parts as [string, string];
  if (!local.startsWith(POOL_PREFIX)) return { ok: false, reason: "not_pool" };
  const ingestDomain = opts.ingestDomain.trim().toLowerCase();
  if (!ingestDomain || domain !== ingestDomain) return { ok: false, reason: "wrong_domain" };
  const career = local.slice(POOL_PREFIX.length);
  if (!/^[a-z0-9_]+$/.test(career) || !opts.careers.includes(career)) {
    return { ok: false, reason: "unknown_career" };
  }
  return { ok: true, career };
}
