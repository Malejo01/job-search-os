import { MAX_JOB_FIELD_CHARS } from "@job-search-os/pipeline";
import { SubmitButton } from "@/app/components/submit-button";
import { buttonClasses, inputClasses } from "@/components/ui";

// C9-11: campos de radio 18 y el botón lima de las primitivas
const input = inputClasses();
const LABEL = "flex flex-col gap-1.5 text-sm";

export type JobFieldsDefaults = {
  url?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  modality?: "remoto" | "hibrido" | "presencial" | "desconocida";
  jdText?: string | null;
};

/**
 * Campos del alta manual, compartidos entre "Completar campos" y "Pegar el aviso entero". Los
 * `name` son los que lee `createManualJobAction`. Sin estado propio: sirve desde un Server
 * Component y desde uno de cliente. Va dentro de un `<form>`.
 */
export function JobFields({
  error,
  defaults = {},
  submitLabel,
  pendingLabel,
  secondaryAction,
  pending,
  namePrefix = "",
  required = true,
  withSubmit = true,
}: {
  error?: string;
  defaults?: JobFieldsDefaults;
  submitLabel: string;
  pendingLabel: string;
  secondaryAction?: React.ReactNode;
  /** Envío a mano (tarjeta del asistente): el botón no puede leerlo de `useFormStatus`. */
  pending?: boolean;
  /**
   * Prefijo de los `name` (R6-3: varias ofertas en un mismo formulario, `o0.title`, `o1.title`…).
   * Vacío = los nombres de siempre.
   */
  namePrefix?: string;
  /** Título y empresa obligatorios. Una oferta destildada en la revisión no bloquea el envío. */
  required?: boolean;
  /** false si el formulario trae su propio botón de envío (revisión de varias ofertas). */
  withSubmit?: boolean;
}) {
  const invalidProps = (key: string) =>
    error === key ? { "aria-invalid": true, "aria-describedby": "alta-error" } : {};
  const n = (field: string) => `${namePrefix}${field}`;
  return (
    <>
      <label className={LABEL}>
        Link del aviso (opcional; sirve para no cargarlo dos veces)
        <input
          name={n("url")}
          type="url"
          placeholder="https://…"
          defaultValue={defaults.url ?? undefined}
          {...invalidProps("url")}
          className={input}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Título *
          <input
            name={n("title")}
            required={required}
            maxLength={MAX_JOB_FIELD_CHARS}
            defaultValue={defaults.title ?? undefined}
            {...invalidProps("campos")}
            className={input}
          />
        </label>
        <label className={LABEL}>
          Empresa *
          <input
            name={n("company")}
            required={required}
            maxLength={MAX_JOB_FIELD_CHARS}
            defaultValue={defaults.company ?? undefined}
            {...invalidProps("campos")}
            className={input}
          />
        </label>
        <label className={LABEL}>
          Ubicación
          <input
            name={n("location")}
            maxLength={MAX_JOB_FIELD_CHARS}
            placeholder="Remoto (Argentina), CABA…"
            defaultValue={defaults.location ?? undefined}
            className={input}
          />
        </label>
        <label className={LABEL}>
          Modalidad
          <select
            name={n("modality")}
            defaultValue={defaults.modality ?? "desconocida"}
            className={input}
          >
            <option value="remoto">Remoto</option>
            <option value="hibrido">Híbrido</option>
            <option value="presencial">Presencial</option>
            <option value="desconocida">No dice</option>
          </select>
        </label>
        <label className={LABEL}>
          Salario USD mensual (mín.)
          <input name={n("salaryMin")} type="number" min={0} className={input} />
        </label>
        <label className={LABEL}>
          Salario USD mensual (máx.)
          <input name={n("salaryMax")} type="number" min={0} className={input} />
        </label>
        <label className={LABEL}>
          Candidatos (si el aviso lo dice)
          <input name={n("candidates")} type="number" min={0} className={input} />
        </label>
      </div>
      <label className={LABEL}>
        Descripción del puesto (pegá el texto completo; si la dejás vacía queda en «Sin
        descripción»)
        <textarea
          name={n("jdText")}
          rows={8}
          defaultValue={defaults.jdText ?? undefined}
          className={inputClasses({ multiline: true })}
        />
      </label>
      {withSubmit ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {secondaryAction}
          <SubmitButton pendingLabel={pendingLabel} pending={pending} className={buttonClasses()}>
            {submitLabel}
          </SubmitButton>
        </div>
      ) : null}
    </>
  );
}
