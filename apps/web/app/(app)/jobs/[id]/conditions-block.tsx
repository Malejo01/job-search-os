import { conditionRows, type ConditionsInput } from "./conditions-view";

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
            <dt className="text-xs text-fg-muted">{r.label}</dt>
            <dd className={r.informed ? "text-fg" : "text-fg-subtle"}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
