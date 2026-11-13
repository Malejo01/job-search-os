import {
  criteriaFormDefaults,
  DISCIPLINES,
  ENGLISH_RISK_LEVELS,
  MAX_ENTRY_CHARS,
  MAX_LIST_ENTRIES,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { getActiveCriteria } from "@/lib/criteria";
import { DISCIPLINE_LABEL } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { resetCriteriaAction, saveCriteriaAction } from "./actions";
import { FieldError, GuardedForm, PendingSubmit } from "@/app/components/guarded-form";
import { AssistantProposalLoader } from "@/components/assistant-proposal-loader";
import { SaveButton } from "./save-button";
import { Alert, buttonClasses, cardClasses, inputClasses } from "@/components/ui";

export const metadata = { title: "Criterios" };
export const dynamic = "force-dynamic";

// C9-11: campos de las primitivas (radio 18)
const input = inputClasses();
const help = "text-xs text-fg-subtle";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const FIELD_ERRORS: Record<string, string> = {
  title_blocklist: `Títulos bloqueados: hasta ${MAX_LIST_ENTRIES} líneas de ${MAX_ENTRY_CHARS} caracteres, sin símbolos raros.`,
  title_allowlist: `Títulos permitidos: hasta ${MAX_LIST_ENTRIES} líneas de ${MAX_ENTRY_CHARS} caracteres, sin símbolos raros.`,
  other_discipline_keywords: `Palabras de otras disciplinas: hasta ${MAX_LIST_ENTRIES} líneas de ${MAX_ENTRY_CHARS} caracteres, sin símbolos raros.`,
  allowed_disciplines: "Marcá al menos una disciplina.",
  salary_floor_usd_monthly:
    "El piso salarial tiene que ser un entero entre 0 y 100000, o quedar vacío.",
  max_weekly_hours: "Las horas máximas tienen que ser un entero entre 1 y 80.",
  max_years_hard: "Los años máximos tienen que ser un entero entre 1 y 40.",
  english_risk_from: "Elegí un nivel de inglés de la lista.",
  threshold_personalizado: "El umbral para personalizar tiene que ser un número entre 0 y 10.",
  threshold_aplicar: "El umbral para aplicar tiene que ser un número entre 0 y 10.",
  threshold_guardar: "El umbral para guardar tiene que ser un número entre 0 y 10.",
  thresholds: "Los umbrales tienen que ir de mayor a menor: personalizar, aplicar, guardar.",
  conflict:
    "Alguien guardó cambios más nuevos. Copiá lo que necesites y recargá: al recargar se muestra la versión nueva.",
};

const ENGLISH_LABEL: Record<(typeof ENGLISH_RISK_LEVELS)[number], string> = {
  basico: "Básico",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
  nativo: "Nativo",
};

/**
 * Criterios editables (JS-096): un subconjunto de las reglas del prefiltro y de decide(). Cada
 * guardado crea una versión nueva; las ofertas ya evaluadas no se recalculan.
 */
export default async function CriteriaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; reset?: string }>;
}) {
  const userId = await requireUserId();
  const [active, { error, saved, reset }] = await Promise.all([
    getActiveCriteria(userId),
    searchParams,
  ]);

  if (!active) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 className="text-title font-bold">Criterios de evaluación</h1>
        <p className="text-sm text-fg-muted">
          Todavía no tenés criterios activos. Completá tu perfil primero.
        </p>
      </div>
    );
  }

  const d = criteriaFormDefaults(active.rules);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-bold tracking-wide text-fg-muted uppercase">Avanzado</p>
        <h1 className="text-title font-bold">Criterios de evaluación</h1>
        <p className="text-sm text-fg-subtle">
          Versión vigente: {active.version} · guardada el {DATE.format(active.createdAt)} (UTC)
        </p>
      </div>

      <Alert tone="warning" role="note">
        Cambiar estos criterios puede hacer que se descarten ofertas que te sirven. Si tenés dudas,
        dejalos como están.
      </Alert>

      <Alert tone="warning" role={null}>
        Los cambios valen para las ofertas nuevas; las ya evaluadas no se recalculan.
      </Alert>

      {saved ? (
        <Alert tone="success" role="status">
          {saved === "reset"
            ? "Volviste a los valores por defecto."
            : "Criterios guardados como una versión nueva."}
        </Alert>
      ) : null}
      {error ? (
        <Alert id="criteria-error" tone="danger" role="alert">
          {FIELD_ERRORS[error] ?? "Revisá los datos del formulario."}
        </Alert>
      ) : null}

      <GuardedForm
        action={saveCriteriaAction}
        messages={FIELD_ERRORS}
        groups={{
          thresholds: ["threshold_personalizado", "threshold_aplicar", "threshold_guardar"],
        }}
        conflictField="conflict"
        className={cardClasses({ padding: "md", className: "flex flex-col gap-5" })}
      >
        <input type="hidden" name="baseVersion" value={active.version} />
        <AssistantProposalLoader destination="criteria" />

        <label className="flex flex-col gap-1.5 text-sm">
          Títulos bloqueados (uno por línea)
          <textarea
            name="title_blocklist"
            rows={6}
            defaultValue={d.title_blocklist}
            className={input}
          />
          <FieldError name="title_blocklist" />
          <span className={help}>
            Un aviso cuyo título contiene alguna de estas palabras se descarta antes de evaluarlo,
            salvo que coincida con los títulos permitidos.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Títulos permitidos (uno por línea)
          <textarea
            name="title_allowlist"
            rows={3}
            defaultValue={d.title_allowlist}
            className={input}
          />
          <FieldError name="title_allowlist" />
          <span className={help}>
            Excepciones a la lista de bloqueados: un título que coincide con una de estas frases
            pasa el filtro.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Palabras de otras disciplinas (una por línea)
          <textarea
            name="other_discipline_keywords"
            rows={6}
            defaultValue={d.other_discipline_keywords}
            className={input}
          />
          <FieldError name="other_discipline_keywords" />
          <span className={help}>
            Si el aviso las menciona como el núcleo del puesto, se considera de otro oficio y el
            puntaje tiene tope.
          </span>
        </label>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-bold text-fg">Disciplinas que buscás</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {DISCIPLINES.map((disc) => (
              <label key={disc} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="allowed_disciplines"
                  value={disc}
                  defaultChecked={d.allowed_disciplines.includes(disc)}
                />
                {DISCIPLINE_LABEL[disc]}
              </label>
            ))}
          </div>
          <FieldError name="allowed_disciplines" />
          <span className={help}>
            Un aviso de una disciplina que no marcaste queda como bloqueador y su puntaje tiene
            tope. Tiene que haber al menos una.
          </span>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            Piso salarial mensual (USD, opcional)
            <input
              name="salary_floor_usd_monthly"
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              step={1}
              defaultValue={d.salary_floor_usd_monthly}
              className={input}
            />
            <FieldError name="salary_floor_usd_monthly" />
            <span className={help}>
              Si lo dejás vacío, no se marca nada por salario. Un salario publicado por debajo de
              este piso se marca.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Horas máximas por semana
            <input
              name="max_weekly_hours"
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              step={1}
              required
              defaultValue={d.max_weekly_hours}
              className={input}
            />
            <FieldError name="max_weekly_hours" />
            <span className={help}>Un aviso que pide más horas se marca como riesgo.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Años máximos que tolerás
            <input
              name="max_years_hard"
              type="number"
              inputMode="numeric"
              min={1}
              max={40}
              step={1}
              required
              defaultValue={d.max_years_hard}
              className={input}
            />
            <FieldError name="max_years_hard" />
            <span className={help}>
              Si el aviso pide más años que estos, es un bloqueador (no se recomienda aplicar).
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Riesgo de inglés desde
            <select name="english_risk_from" defaultValue={d.english_risk_from} className={input}>
              {ENGLISH_RISK_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {ENGLISH_LABEL[l]}
                </option>
              ))}
            </select>
            <FieldError name="english_risk_from" />
            <span className={help}>
              Desde qué nivel exigido en el aviso se reporta riesgo si tu inglés está por debajo.
            </span>
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-bold text-fg">Umbrales de puntaje (0 a 10)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              Personalizar desde
              <input
                name="threshold_personalizado"
                type="number"
                inputMode="decimal"
                min={0}
                max={10}
                step={0.5}
                required
                defaultValue={d.threshold_personalizado}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              Aplicar desde
              <input
                name="threshold_aplicar"
                type="number"
                inputMode="decimal"
                min={0}
                max={10}
                step={0.5}
                required
                defaultValue={d.threshold_aplicar}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              Guardar desde
              <input
                name="threshold_guardar"
                type="number"
                inputMode="decimal"
                min={0}
                max={10}
                step={0.5}
                required
                defaultValue={d.threshold_guardar}
                className={input}
              />
            </label>
          </div>
          <FieldError name="thresholds" />
          <FieldError name="threshold_personalizado" />
          <FieldError name="threshold_aplicar" />
          <FieldError name="threshold_guardar" />
          <span className={help}>
            Con qué puntaje (sin bloqueadores) la acción recomendada pasa a personalizar, aplicar o
            guardar. Tienen que ir de mayor a menor. Con 0 en &ldquo;Guardar desde&rdquo; no se
            descarta nada por puntaje.
          </span>
        </fieldset>

        <div className="flex justify-end">
          <PendingSubmit className={buttonClasses()}>Guardar como versión nueva</PendingSubmit>
        </div>
      </GuardedForm>

      <section className="border-t border-line pt-5 text-sm">
        {reset === "confirm" ? (
          <form action={resetCriteriaAction} className="flex flex-col gap-2">
            <input type="hidden" name="baseVersion" value={active.version} />
            <p className="text-fg-muted">
              Se crea una versión nueva con los valores por defecto. Tu piso salarial y tus horas
              del perfil se conservan. Las ofertas ya evaluadas no se recalculan.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SaveButton
                label="Sí, volver a los valores por defecto"
                pendingLabel="Restableciendo…"
                className={buttonClasses({ variant: "danger", size: "sm" })}
              />
              <Link
                href="/settings/criteria"
                className={buttonClasses({ variant: "secondary", size: "sm" })}
              >
                Cancelar
              </Link>
            </div>
          </form>
        ) : (
          <Link
            href="/settings/criteria?reset=confirm"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Volver a los valores por defecto
          </Link>
        )}
      </section>
    </div>
  );
}
