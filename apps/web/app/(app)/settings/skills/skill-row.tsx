import { SELF_LEVELS } from "@job-search-os/pipeline";

/**
 * Una skill con sus 4 niveles en palabras. `fieldset` + `legend` por skill, radios con label real.
 * Sin hooks: lo usan el formulario (servidor) y el buscador (cliente).
 */
export function SkillRow({
  slug,
  name,
  level,
  removable = false,
}: {
  slug: string;
  name: string;
  /** Nivel ya declarado, o undefined si todavía no respondió. */
  level?: number;
  /** Con nivel guardado: muestra "Quitar" (vuelve a "sin dato"). */
  removable?: boolean;
}) {
  return (
    <fieldset
      data-testid={`skill-${slug}`}
      className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3"
    >
      <legend className="px-1 text-sm font-medium">{name}</legend>
      <div className="flex flex-col gap-1 text-sm sm:grid sm:grid-cols-2">
        {SELF_LEVELS.map((l) => (
          <label
            key={l.level}
            htmlFor={`${slug}-${l.level}`}
            className="flex min-h-11 items-center gap-2 rounded-md px-1 py-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-zinc-900"
          >
            <input
              id={`${slug}-${l.level}`}
              type="radio"
              name={`level:${slug}`}
              value={l.level}
              defaultChecked={level === l.level}
              className="h-5 w-5"
            />
            {l.label}
          </label>
        ))}
      </div>
      {removable ? (
        <button
          type="submit"
          name="quitar"
          value={slug}
          aria-label={`Quitar ${name}`}
          className="min-h-11 self-start rounded-md border border-zinc-300 px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
        >
          Quitar
        </button>
      ) : null}
    </fieldset>
  );
}
