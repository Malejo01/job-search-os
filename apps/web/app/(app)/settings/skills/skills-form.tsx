import {
  isRoleKey,
  suggestedSkills,
  type RoleKey,
  type RoleSkillsMap,
} from "@job-search-os/pipeline";
import Link from "next/link";
import type { TaxonomySkill } from "@/lib/skill-levels";
import { SkillRow } from "./skill-row";
import { SkillSearch } from "./skill-search";

export function parseRoleParam(value: string | undefined): RoleKey | null {
  return isRoleKey(value) ? value : null;
}

/**
 * Pantalla compartida de skills autodeclaradas (ajustes y onboarding): selector de rol, skills
 * sugeridas del rol, las que la persona ya tiene con nivel y un buscador para sumar otras.
 * Server Component; solo el buscador es de cliente.
 */
export function SkillsForm({
  action,
  basePath,
  roleMap,
  role,
  taxonomy,
  levels,
  submitLabel,
  skip,
  allowRemove = true,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Ruta de la pantalla: los links del selector de rol son `${basePath}?rol=<clave>`. */
  basePath: string;
  roleMap: RoleSkillsMap;
  role: RoleKey | null;
  taxonomy: TaxonomySkill[];
  levels: Record<string, number>;
  submitLabel: string;
  skip?: { href: string; label: string };
  /** Muestra "Quitar" en las skills con nivel guardado (no en el onboarding). */
  allowRemove?: boolean;
}) {
  const byslug = new Map(taxonomy.map((t) => [t.slug, t]));
  const suggested = role ? suggestedSkills(role, roleMap).filter((slug) => byslug.has(slug)) : [];
  const suggestedSet = new Set(suggested);
  // Lo que ya declaró se ve siempre, aunque no sea del rol
  const own = taxonomy.filter((t) => t.slug in levels && !suggestedSet.has(t.slug));
  const shown = new Set([...suggested, ...own.map((t) => t.slug)]);
  const options = taxonomy
    .filter((t) => !shown.has(t.slug))
    .map((t) => ({ slug: t.slug, name: t.name, aliases: t.aliases }));

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Rol objetivo" className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Qué rol buscás</h2>
        <ul className="flex flex-wrap gap-2">
          {(Object.keys(roleMap) as RoleKey[]).map((key) => (
            <li key={key}>
              <Link
                href={`${basePath}?rol=${key}`}
                aria-current={key === role ? "true" : undefined}
                className={`inline-block rounded-md border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900 ${
                  key === role
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 text-zinc-900"
                }`}
              >
                {roleMap[key].label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-zinc-600">Cambiar de rol descarta lo que no guardaste.</p>
      </nav>

      {role === null && own.length === 0 ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          Elegí un rol para ver las skills más comunes de ese puesto.
        </p>
      ) : null}

      <form action={action} className="flex flex-col gap-4">
        {/* Primer botón del formulario: Enter guarda y no dispara el "Quitar" de la primera fila */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Guardar
        </button>

        {suggested.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="skills-del-rol">
            <h2 id="skills-del-rol" className="text-base font-medium">
              Skills de {role ? roleMap[role].label : ""}
            </h2>
            {suggested.map((slug) => (
              <SkillRow
                key={slug}
                slug={slug}
                name={byslug.get(slug)!.name}
                level={levels[slug]}
                removable={allowRemove && slug in levels}
              />
            ))}
          </section>
        ) : null}

        {own.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="skills-tuyas">
            <h2 id="skills-tuyas" className="text-base font-medium">
              Otras skills que ya cargaste
            </h2>
            {own.map((t) => (
              <SkillRow
                key={t.slug}
                slug={t.slug}
                name={t.name}
                level={levels[t.slug]}
                removable={allowRemove}
              />
            ))}
          </section>
        ) : null}

        <SkillSearch options={options} />

        <div className="flex flex-wrap items-center justify-end gap-3">
          {skip ? (
            <Link
              href={skip.href}
              className="rounded-md border border-zinc-300 px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
            >
              {skip.label}
            </Link>
          ) : null}
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
