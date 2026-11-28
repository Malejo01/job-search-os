import type { Checklist } from "@job-search-os/pipeline";
import { Icon, type IconName } from "@/components/ui";
import { DETALLE_TEXTOS, ESTADO_REQUISITO_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { encajaView, type EncajaRow } from "./como-encaja-view";

const T = DETALLE_TEXTOS.encaja;

/** Cada estado lleva ícono y texto; los tres con el mismo peso visual para que «Sin confirmar» no alarme. */
const MARK: Record<EncajaRow["state"], IconName> = {
  coincide: "check",
  sinConfirmar: "pregunta",
  noCoincide: "cruz",
};

function Row({ row }: { row: EncajaRow }) {
  return (
    <li className="flex min-w-0 gap-3" data-testid={`encaja-${row.id}`}>
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-fg"
      >
        <Icon name={MARK[row.state]} size={16} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs font-bold text-fg-muted">
          {ESTADO_REQUISITO_TEXTOS[row.state]} · {row.nivel === "must" ? T.excluyente : T.deseable}
        </span>
        <span className="break-words font-semibold">{llenarTexto(T.pide, { pide: row.pide })}</span>
        <span className="break-words text-xs text-fg-muted">
          {row.tenes !== null ? llenarTexto(T.tenes, { tenes: row.tenes }) : T.sinDato}
        </span>
      </div>
    </li>
  );
}

/**
 * «Cómo encaja» (R30-08): el veredicto y hasta 3 cosas que más pesan, calculadas solo desde la tabla
 * de requisitos. La condición excluyente que no coincide se explica aparte de la afinidad.
 * Server Component, sin consultas.
 */
export function ComoEncaja({ checklist }: { checklist: Pick<Checklist, "items"> | null }) {
  const view = encajaView(checklist);
  return (
    <section
      aria-labelledby="como-encaja-titulo"
      data-testid="como-encaja"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line p-4 text-sm"
    >
      <h2 id="como-encaja-titulo" className="font-display text-base font-bold">
        {T.titulo}
      </h2>
      <p data-testid="como-encaja-veredicto" className="font-semibold">
        {T.veredicto[view.verdict]}
      </p>
      {view.blocking ? (
        <div data-testid="condicion-excluyente" className="rounded-control bg-surface-muted p-3">
          <p className="text-xs font-bold text-fg-muted">{T.condicionTitulo}</p>
          <p className="break-words font-semibold">{view.blocking.pide}</p>
          <p className="text-xs text-fg-muted">{T.condicionExplica}</p>
        </div>
      ) : null}
      {view.rows.length ? (
        <div>
          <h3 className="text-xs font-bold text-fg-muted">{T.pesan}</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {view.rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
