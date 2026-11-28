import { ContextHelp } from "@/components/context-help";
import { DETALLE_TEXTOS } from "@/lib/textos-rediseno";
import { Cita } from "./ficha-bloques";
import { conditionRows, type ConditionKey, type ConditionsInput } from "./conditions-view";

/** Ficha de Academy que explica cada campo (solo aparece si está aprobada). */
const HELP: Partial<Record<ConditionKey, { slug: string; term: string }>> = {
  seniority: { slug: "seniority", term: "seniority" },
  modality: { slug: "presencial-hibrido-remoto", term: "presencial, híbrido, remoto" },
  salary: { slug: "rango-salarial", term: "rango salarial" },
};

/**
 * «Lo importante para decidir» (R30-08): las 7 filas del aviso, con «No especificado» cuando falta.
 * Server Component, sin consultas. Nunca mezcla datos del perfil.
 */
export function ConditionsBlock({ input }: { input: ConditionsInput }) {
  const rows = conditionRows(input);
  const T = DETALLE_TEXTOS.condiciones;
  return (
    <section
      aria-labelledby="condiciones-titulo"
      data-testid="condiciones"
      className="rounded-card border border-line p-3 text-sm"
    >
      <h2 id="condiciones-titulo" className="font-semibold">
        {T.titulo}
      </h2>
      <p className="text-xs text-fg-muted">{T.nota}</p>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} data-testid={`condicion-${r.key}`} className="flex flex-col">
            <dt className="flex items-center gap-1 text-xs text-fg-muted">
              {r.label}
              {HELP[r.key] ? (
                <ContextHelp slug={HELP[r.key]!.slug} term={HELP[r.key]!.term} desde="avisos" />
              ) : null}
            </dt>
            {/* La cita va dentro del <dd>: un <dl> solo admite dt, dd y div (axe: definition-list) */}
            <dd className={r.informed ? "text-fg" : "text-fg-subtle"}>
              {r.value}
              {r.cita ? <Cita cita={r.cita} /> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
