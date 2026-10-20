import { SubmitButton } from "@/app/components/submit-button";

const input = "rounded-md border border-zinc-300 px-3 py-2 text-base";

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
}: {
  error?: string;
  defaults?: JobFieldsDefaults;
  submitLabel: string;
  pendingLabel: string;
  secondaryAction?: React.ReactNode;
}) {
  const invalidProps = (key: string) =>
    error === key ? { "aria-invalid": true, "aria-describedby": "alta-error" } : {};
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Link del aviso (opcional; sirve para no cargarlo dos veces)
        <input
          name="url"
          type="url"
          placeholder="https://…"
          defaultValue={defaults.url ?? undefined}
          {...invalidProps("url")}
          className={input}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Título *
          <input
            name="title"
            required
            defaultValue={defaults.title ?? undefined}
            {...invalidProps("campos")}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Empresa *
          <input
            name="company"
            required
            defaultValue={defaults.company ?? undefined}
            {...invalidProps("campos")}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ubicación
          <input
            name="location"
            placeholder="Remoto (Argentina), CABA…"
            defaultValue={defaults.location ?? undefined}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Modalidad
          <select
            name="modality"
            defaultValue={defaults.modality ?? "desconocida"}
            className={input}
          >
            <option value="remoto">Remoto</option>
            <option value="hibrido">Híbrido</option>
            <option value="presencial">Presencial</option>
            <option value="desconocida">No dice</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Salario USD mensual (mín.)
          <input name="salaryMin" type="number" min={0} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Salario USD mensual (máx.)
          <input name="salaryMax" type="number" min={0} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Candidatos (si el aviso lo dice)
          <input name="candidates" type="number" min={0} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Descripción del puesto (pegá el texto completo; si la dejás vacía queda en «Sin
        descripción»)
        <textarea
          name="jdText"
          rows={8}
          defaultValue={defaults.jdText ?? undefined}
          className={input}
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {secondaryAction}
        <SubmitButton
          pendingLabel={pendingLabel}
          className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
        >
          {submitLabel}
        </SubmitButton>
      </div>
    </>
  );
}
