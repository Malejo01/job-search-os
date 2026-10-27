import { SELF_LEVELS } from "@job-search-os/pipeline";
import { FieldError } from "@/app/components/guarded-form";
import { SkillInfo } from "@/components/skill-info";

/**
 * Una skill con sus 4 niveles en palabras. `fieldset` + `legend` por skill, radios con label real.
 * Sin hooks propios: lo usan el formulario (servidor) y el buscador (cliente). Si la acción rechaza
 * el nivel de esta fila, `GuardedForm` marca los radios (`aria-invalid`) y `FieldError` muestra el aviso.
 * Sirve para tres tipos de fila: de la taxonomía (`level:<slug>`), propia ya guardada
 * (`clevel:<id>`) y propia nueva (`new_level:<k>`); por defecto es la primera.
 */
export function SkillRow({
  slug,
  name,
  level,
  removable = false,
  description,
  fieldName = `level:${slug}`,
  removeName = "quitar",
  removeValue = slug,
  onRemove,
}: {
  /** Identifica la fila: `data-testid="skill-<slug>"` y los ids de los radios. */
  slug: string;
  name: string;
  /** Nivel ya declarado, o undefined si todavía no respondió. */
  level?: number;
  /** Con nivel guardado: muestra "Quitar" (vuelve a "sin dato"). */
  removable?: boolean;
  /** Frase de «¿Qué es?»; sin ella no se muestra el botón. */
  description?: string | null;
  /** Nombre de los radios en el formulario. */
  fieldName?: string;
  /** Campo y valor del botón «Quitar» cuando envía el formulario. */
  removeName?: string;
  removeValue?: string;
  /** Si se pasa, «Quitar» es un botón común que llama a esto en vez de enviar el formulario. */
  onRemove?: () => void;
}) {
  const showRemove = removable || onRemove !== undefined;
  return (
    <fieldset
      data-testid={`skill-${slug}`}
      className="flex flex-col gap-2 rounded-card border border-line p-3"
    >
      <legend className="px-1 text-sm font-medium">{name}</legend>
      <div className="grid grid-cols-2 gap-1 text-sm">
        {SELF_LEVELS.map((l) => (
          <label
            key={l.level}
            htmlFor={`${slug}-${l.level}`}
            className="flex min-h-11 items-center gap-2 rounded-control px-1 py-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus"
          >
            <input
              id={`${slug}-${l.level}`}
              type="radio"
              name={fieldName}
              value={l.level}
              defaultChecked={level === l.level}
              className="h-5 w-5"
            />
            {l.label}
          </label>
        ))}
      </div>
      <FieldError name={fieldName} />
      {/* «¿Qué es?» y «Quitar» en una sola fila; el panel de la descripción va debajo (order-last) */}
      {showRemove || description ? (
        <div className="flex flex-wrap items-center gap-2">
          <SkillInfo description={description} />
          {showRemove ? (
            onRemove ? (
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Quitar ${name}`}
                className="min-h-11 rounded-control border border-line-strong px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                Quitar
              </button>
            ) : (
              <button
                type="submit"
                name={removeName}
                value={removeValue}
                aria-label={`Quitar ${name}`}
                className="min-h-11 rounded-control border border-line-strong px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                Quitar
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
