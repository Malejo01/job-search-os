import { APPLICATION_OUTCOMES } from "@job-search-os/pipeline";
import { buttonClasses, inputClasses } from "@/components/ui";
import type { ApplicationFollowUp } from "@/lib/applications";
import { OUTCOME_LABELS } from "@/lib/labels";
import { MERCADO_TEXTOS } from "@/lib/textos-rediseno";
import { setOutcomeAction } from "../applications/actions";

const T = MERCADO_TEXTOS.seguimiento;

/** «2026-11-27» -> «27/11/2026» */
const dateOf = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Seguimiento mínimo de una oferta en «Ya me postulé» (R34-04): la fecha de la postulación y el estado, que la
 * persona cambia a mano con la acción que ya existe (`setOutcomeAction`, con su `user_id` y la RLS). Sin
 * recordatorios ni predicciones. Server Component: un formulario común, sin JavaScript. Va encima del link que
 * cubre la tarjeta (`relative z-10`). La nota del estado se conserva tal cual: el formulario la reenvía.
 */
export function SeguimientoPostulacion({ followUp }: { followUp: ApplicationFollowUp }) {
  return (
    <div
      data-testid="seguimiento-postulacion"
      className="relative z-10 flex flex-col gap-2 border-t border-line pt-2.5"
    >
      <p data-testid="seguimiento-fecha" className="text-sm font-semibold text-fg">
        {T.fecha.replace("{fecha}", dateOf(followUp.appliedOn))}
      </p>
      <form
        // Con lo guardado en la key, el formulario se remonta y el valor sigue a la base
        key={`${followUp.outcome}|${followUp.outcomeNote ?? ""}`}
        action={setOutcomeAction}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="applicationId" value={followUp.applicationId} />
        <input type="hidden" name="note" value={followUp.outcomeNote ?? ""} />
        <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg-muted">
          {T.estado}
          <select
            name="outcome"
            defaultValue={followUp.outcome}
            data-testid="seguimiento-estado"
            className={inputClasses({ className: "sm:w-auto" })}
          >
            {APPLICATION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o] ?? o}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          {T.guardar}
        </button>
      </form>
    </div>
  );
}
