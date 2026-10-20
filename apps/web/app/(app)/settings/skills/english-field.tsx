import { CEFR_LEVELS } from "@job-search-os/pipeline";
import { FieldError } from "@/app/components/guarded-form";
import { CefrHelp } from "@/components/cefr-help";

/**
 * Nivel de inglés (CEFR) arriba de la pantalla de skills (ronda 78), en ajustes y en el onboarding.
 * Al guardar, la acción actualiza `profiles.english_cefr` y deriva los niveles de las dos skills de
 * inglés (`skillLevelsFromCefr`); esas skills no se muestran como filas. La ayuda es la misma del
 * paso 1 del onboarding (`CefrHelp`).
 */
export function EnglishField({ value }: { value: string | null }) {
  const current = (CEFR_LEVELS as readonly string[]).includes(value ?? "") ? (value ?? "") : "";
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ingles-cefr">
      <h2 id="ingles-cefr" className="text-base font-medium">
        Inglés
      </h2>
      <label className="flex flex-col gap-1 text-sm">
        Tu nivel de inglés
        <select
          name="englishCefr"
          defaultValue={current}
          aria-describedby="cefr-help-skills"
          className="min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-base"
        >
          {current === "" ? <option value="">Sin dato</option> : null}
          {CEFR_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <FieldError name="englishCefr" />
      </label>
      <p id="cefr-help-skills" className="text-xs text-zinc-600">
        Escala CEFR, la que usan muchos avisos. Si dudás entre dos, elegí el más bajo.
      </p>
      <CefrHelp />
    </section>
  );
}
