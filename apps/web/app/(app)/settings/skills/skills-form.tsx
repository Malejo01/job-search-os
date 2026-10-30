import {
  ENGLISH_SKILL_SLUGS,
  selectableRoleGroups,
  suggestedSkills,
  toRoleKey,
  type RoleKey,
  type RoleSkillsMap,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { GuardedForm, PendingSubmit, type FormActionError } from "@/app/components/guarded-form";
import { AssistantProposalLoader } from "@/components/assistant-proposal-loader";
import type { CustomSkill, TaxonomySkill } from "@/lib/skill-levels";
import { EnglishField } from "./english-field";
import { SkillRow } from "./skill-row";
import { SkillSearch } from "./skill-search";

/**
 * Mensajes por campo de `parseSkillLevelsForm` y de las skills propias. `level:<slug>`,
 * `clevel:<id>`, `new_name:<k>` y `new_level:<k>` caen en `level`, `clevel`, `new_name` y `new_level`.
 */
const SKILL_ERRORS: Record<string, string> = {
  level: "Hay un nivel que no es válido. Elegí uno de los cuatro de esa skill y volvé a guardar.",
  niveles: "Hay demasiadas skills en el formulario. Recargá la página y volvé a intentar.",
  slug: "Hay una skill que no se reconoce. Recargá la página y volvé a intentar.",
  englishCefr: "Elegí un nivel de inglés de la lista, de A1 a C2.",
  clevel: "Hay un nivel que no es válido. Elegí uno de los cuatro de esa skill y volvé a guardar.",
  new_name:
    "El nombre de la skill que agregaste no sirve: usá de 2 a 40 caracteres, sin links ni < >, y que no esté repetida ni ya en la lista. Quitala y probá de nuevo.",
  new_level: "Elegí un nivel para la skill que agregaste.",
  custom_max: "Llegaste al máximo de skills agregadas por vos. Quitá alguna para sumar otra.",
  custom_form: "Hay una skill agregada que no se reconoce. Recargá la página y volvé a intentar.",
};

/** Las dos skills de inglés se editan con el select de CEFR de arriba, no como filas. */
const ENGLISH_SLUGS: ReadonlySet<string> = new Set(ENGLISH_SKILL_SLUGS);

export function parseRoleParam(value: string | undefined): RoleKey | null {
  return toRoleKey(value);
}

/**
 * Pantalla compartida de skills autodeclaradas (ajustes y onboarding): selector de rol, skills
 * sugeridas del rol, las que la persona ya tiene con nivel y un buscador para sumar otras (de la
 * lista o propias). Arriba va el nivel de inglés (CEFR). Server Component; solo el buscador es de cliente.
 */
export function SkillsForm({
  action,
  basePath,
  roleMap,
  role,
  taxonomy,
  levels,
  englishCefr,
  customSkills,
  submitLabel,
  skip,
  allowRemove = true,
  selectedRoles = [],
  withAssistant = false,
}: {
  action: (formData: FormData) => Promise<FormActionError | void>;
  /** Ruta de la pantalla: los links del selector de rol son `${basePath}?rol=<clave>`. */
  basePath: string;
  roleMap: RoleSkillsMap;
  role: RoleKey | null;
  taxonomy: TaxonomySkill[];
  levels: Record<string, number>;
  /** `profiles.english_cefr`, o null si no lo cargó. */
  englishCefr: string | null;
  /** Skills agregadas a mano (`user_skills`). */
  customSkills: CustomSkill[];
  submitLabel: string;
  /** Botón del mismo formulario (`name="saltear"`): la acción decide no guardar los niveles. */
  skip?: { label: string };
  /** Muestra "Quitar" en las skills con nivel guardado (no en el onboarding). */
  allowRemove?: boolean;
  /** Puestos que eligió la persona: van primero entre los pills (solo sugieren skills). */
  selectedRoles?: readonly RoleKey[];
  /** Carga una propuesta del asistente (AG-3), solo en Ajustes; nada se guarda sin «Guardar». */
  withAssistant?: boolean;
}) {
  const byslug = new Map(taxonomy.map((t) => [t.slug, t]));
  const suggested = role
    ? suggestedSkills(role, roleMap).filter((slug) => byslug.has(slug) && !ENGLISH_SLUGS.has(slug))
    : [];
  const suggestedSet = new Set(suggested);
  // Lo que ya declaró se ve siempre, aunque no sea del rol (menos el inglés, que va arriba)
  const own = taxonomy.filter(
    (t) => t.slug in levels && !suggestedSet.has(t.slug) && !ENGLISH_SLUGS.has(t.slug),
  );
  const shown = new Set([...suggested, ...own.map((t) => t.slug)]);
  // Primero los puestos elegidos y después el resto, por grupo
  const chosen = selectedRoles.filter((key) => key in roleMap);
  const pillGroups = [
    ...(chosen.length > 0 ? [{ label: "Tus puestos", roles: chosen }] : []),
    ...selectableRoleGroups()
      .map((group) => ({
        label: group.label,
        roles: group.roles.filter((key) => key in roleMap && !chosen.includes(key)),
      }))
      .filter((group) => group.roles.length > 0),
  ];
  const options = taxonomy
    .filter((t) => !shown.has(t.slug) && !ENGLISH_SLUGS.has(t.slug))
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      aliases: t.aliases,
      description: t.description,
    }));
  // Para rechazar una skill propia que ya existe: toda la taxonomía, también lo que ya tiene fila
  const taxonomyTerms = taxonomy.map((t) => ({ slug: t.slug, name: t.name, aliases: t.aliases }));

  return (
    <div className="flex flex-col gap-5">
      <nav
        aria-label="Puesto de las sugerencias"
        data-tour="skills:puestos"
        className="flex flex-col gap-2"
      >
        <h2 className="text-base font-medium">Skills sugeridas de</h2>
        {pillGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-fg-subtle">{group.label}</h3>
            <ul className="flex flex-wrap gap-2">
              {group.roles.map((key) => (
                <li key={key}>
                  <Link
                    href={`${basePath}?rol=${key}`}
                    aria-current={key === role ? "true" : undefined}
                    className={`inline-block rounded-control border px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                      key === role
                        ? "border-brand bg-brand text-brand-contrast"
                        : "border-line-strong text-fg"
                    }`}
                  >
                    {roleMap[key].label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-fg-subtle">
          Solo cambia las skills que ves; tus puestos se cambian en Ajustes. Cambiar de puesto acá
          descarta lo que no guardaste.
        </p>
      </nav>

      {role === null && own.length === 0 ? (
        <p className="rounded-control bg-surface-subtle px-3 py-2 text-sm text-fg-muted">
          Elegí un rol para ver las skills más comunes de ese puesto.
        </p>
      ) : null}

      <GuardedForm action={action} messages={SKILL_ERRORS} className="flex flex-col gap-4">
        {/* Primer botón del formulario: Enter guarda y no dispara el "Quitar" de la primera fila */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Guardar
        </button>

        {withAssistant ? <AssistantProposalLoader destination="skill_levels" /> : null}

        <EnglishField value={englishCefr} />

        {suggested.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="skills-del-rol">
            <h2 id="skills-del-rol" className="text-base font-medium">
              Skills de {role ? roleMap[role].label : ""}
            </h2>
            {suggested.map((slug, i) => {
              const row = (
                <SkillRow
                  key={slug}
                  slug={slug}
                  name={byslug.get(slug)!.name}
                  description={byslug.get(slug)!.description}
                  level={levels[slug]}
                  removable={allowRemove && slug in levels}
                />
              );
              // Ancla de la guía (ronda 92): solo la primera fila
              return i === 0 ? (
                <div key={slug} data-tour="skills:nivel">
                  {row}
                </div>
              ) : (
                row
              );
            })}
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
                description={t.description}
                level={levels[t.slug]}
                removable={allowRemove}
              />
            ))}
          </section>
        ) : null}

        {customSkills.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="skills-agregadas">
            <h2 id="skills-agregadas" className="text-base font-medium">
              Tus skills agregadas
            </h2>
            {customSkills.map((c) => (
              <SkillRow
                key={c.id}
                slug={`propia-${c.id}`}
                name={c.name}
                level={c.level}
                fieldName={`clevel:${c.id}`}
                removable={allowRemove}
                removeName="quitar_propia"
                removeValue={c.id}
              />
            ))}
          </section>
        ) : null}

        <div data-tour="skills:buscar">
          <SkillSearch
            options={options}
            taxonomy={taxonomyTerms}
            customNames={customSkills.map((c) => c.name)}
          />
        </div>

        {/* «Guardar» va primero en el DOM (Enter guarda, nunca saltea); row-reverse lo deja a la derecha.
            `--tour-panel-h` lo fija la guía mientras está abierta: la barra queda encima del panel */}
        <div className="sticky bottom-[var(--tour-panel-h,0px)] flex flex-row-reverse flex-wrap items-center justify-start gap-3 border-t border-line bg-surface p-3">
          <PendingSubmit
            pendingLabel="Guardando…"
            className="rounded-control bg-brand px-4 py-2 text-base font-medium text-brand-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {submitLabel}
          </PendingSubmit>
          {skip ? (
            <button
              type="submit"
              name="saltear"
              value="1"
              data-tour="skills:saltear"
              className="rounded-control border border-line-strong px-4 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {skip.label}
            </button>
          ) : null}
        </div>
      </GuardedForm>
    </div>
  );
}
