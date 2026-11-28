import type { AffinityItem } from "@job-search-os/pipeline";
import { ContextHelp } from "@/components/context-help";
import { AnimatedDetails, GrowBar } from "@/components/motion/disclosure";
import { AYUDAS_ACADEMY, COMO_CALCULAMOS_TEXTOS as T, SELLOS_TEXTOS } from "@/lib/textos-rediseno";
import { affinityRows } from "./affinity-view";

/**
 * «Cómo calculamos la afinidad» (R17-03, rehecho en R30-02): qué sale del aviso, qué sale del perfil y qué está sin
 * confirmar, más una barra por criterio con puntaje y palabra. Es una explicación del puntaje con datos que la
 * evaluación ya tiene; no cambia el número del sello. «Sin confirmar» son los criterios sin dato (nunca se
 * inventa un número). Va en un `<details>`: se abre con teclado (Enter o espacio sobre el resumen) y no necesita
 * JavaScript. R23-06: al abrirse crece en altura y las barras se llenan (`AnimatedDetails`, `GrowBar`; sin
 * animación con movimiento reducido).
 *
 * La aclaración fija (regla 5 del plan) va fuera del `<details>`: se lee siempre, sin abrir nada.
 */
export function AffinityDetail({ items }: { items: readonly AffinityItem[] }) {
  const rows = affinityRows(items);
  const sinConfirmar = rows.filter((r) => r.scoreText === null);
  return (
    <>
      <p className="text-sm text-fg-muted" data-testid="afinidad-aclaracion">
        {SELLOS_TEXTOS.aclaracion}
      </p>
      <AnimatedDetails
        id="composicion"
        data-testid="afinidad-detalle"
        className="rounded-card border border-line p-3 text-sm"
        summaryClassName="flex min-h-11 cursor-pointer items-center font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        summary={T.summary}
      >
        <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
          {T.intro}
          <ContextHelp
            slug={AYUDAS_ACADEMY.afinidad.slug}
            term={AYUDAS_ACADEMY.afinidad.term}
            desde="avisos"
          />
        </p>
        <dl className="mt-3 flex flex-col gap-2" data-testid="afinidad-origen">
          <div>
            <dt className="font-medium text-fg">{T.avisoTitle}</dt>
            <dd className="text-xs text-fg-muted">{T.avisoText}</dd>
          </div>
          <div>
            <dt className="font-medium text-fg">{T.perfilTitle}</dt>
            <dd className="text-xs text-fg-muted">{T.perfilText}</dd>
          </div>
          <div data-testid="afinidad-sin-confirmar">
            <dt className="font-medium text-fg">{T.sinConfirmarTitle}</dt>
            <dd className="text-xs text-fg-muted">
              {sinConfirmar.length ? (
                <>
                  {T.sinConfirmarText} {sinConfirmar.map((r) => r.label).join(", ")}.
                </>
              ) : (
                T.sinConfirmarNinguno
              )}
            </dd>
          </div>
        </dl>
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.key} data-testid={`afinidad-${r.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-fg" id={`afinidad-${r.key}-label`}>
                  {r.label}
                </span>
                <span className="text-xs text-fg-muted">
                  {r.scoreText !== null ? `${r.scoreText}/10 · ${r.word}` : r.word}
                </span>
              </div>
              {r.scoreText !== null ? (
                <div
                  role="meter"
                  aria-labelledby={`afinidad-${r.key}-label`}
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={r.percent / 10}
                  aria-valuetext={`${r.scoreText} de 10, ${r.word}`}
                  className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                >
                  <GrowBar percent={r.percent} index={i} className="h-full rounded-full bg-fg" />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">{T.condicionText}</p>
      </AnimatedDetails>
    </>
  );
}
