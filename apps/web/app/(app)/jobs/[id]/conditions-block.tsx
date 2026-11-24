import { ContextHelp } from "@/components/context-help";
import { conditionRows, type ConditionRow, type ConditionsInput } from "./conditions-view";

/** Ficha de Academy que explica cada campo (solo aparece si está aprobada). */
const HELP: Partial<Record<ConditionRow["key"], { slug: string; term: string }>> = {
  seniority: { slug: "seniority", term: "seniority" },
  modality: { slug: "presencial-hibrido-remoto", term: "presencial, híbrido, remoto" },
  salary: { slug: "rango-salarial", term: "rango salarial" },
};

/** Condiciones laborales (R17-04): lo que el aviso dice y lo que no. Server Component, sin consultas. */
export function ConditionsBlock({ input }: { input: ConditionsInput }) {
  const rows = conditionRows(input);
  return (
    <section
      aria-labelledby="condiciones-titulo"
      data-testid="condiciones"
      className="rounded-card border border-line p-3 text-sm"
    >
      <h2 id="condiciones-titulo" className="font-semibold">
        Condiciones laborales
      </h2>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} data-testid={`condicion-${r.key}`} className="flex flex-col">
            <dt className="flex items-center gap-1 text-xs text-fg-muted">
              {r.label}
              {HELP[r.key] ? (
                <ContextHelp slug={HELP[r.key]!.slug} term={HELP[r.key]!.term} desde="avisos" />
              ) : null}
            </dt>
            <dd className={r.informed ? "text-fg" : "text-fg-subtle"}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
