import type { RoleKey } from "@job-search-os/pipeline";
import Link from "next/link";
import { ROLE_SKILLS } from "@/lib/skill-levels";

/**
 * Pestañas por puesto de /market (ronda 45): links `?rol=<clave>` solo entre los puestos que
 * la persona eligió. Con uno solo no hay nada que elegir y no se muestra. Server Component.
 */
export function RoleTabs({
  basePath,
  roles,
  active,
  keep = {},
}: {
  basePath: string;
  roles: readonly RoleKey[];
  active: RoleKey | null;
  /** Otros parámetros de la página que el link conserva (por ejemplo el rango de semanas). */
  keep?: Record<string, string | null>;
}) {
  if (roles.length < 2) return null;
  const hrefFor = (key: RoleKey) => {
    const query = new URLSearchParams({ rol: key });
    for (const [name, value] of Object.entries(keep)) if (value) query.set(name, value);
    return `${basePath}?${query.toString()}`;
  };
  return (
    <nav aria-label="Puestos" className="flex flex-wrap gap-2">
      {roles.map((key) => (
        <Link
          key={key}
          href={hrefFor(key)}
          aria-current={key === active ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-control border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
            key === active
              ? "border-brand bg-brand text-brand-contrast"
              : "border-line-strong text-fg"
          }`}
        >
          {ROLE_SKILLS[key].label}
        </Link>
      ))}
    </nav>
  );
}
