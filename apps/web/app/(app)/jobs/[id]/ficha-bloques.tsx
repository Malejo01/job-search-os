import Link from "next/link";
import { SubmitButton } from "@/app/components/submit-button";
import { buttonClasses } from "@/components/ui/button";
import { PANTALLA_TEXTOS } from "@/lib/textos-rediseno";
import { AutoRefresh } from "../auto-refresh";
import type { FichaDato, FichaEstado, FichaRequisito, FichaView } from "./ficha-view";

const T = PANTALLA_TEXTOS;

/**
 * Cita literal del aviso, plegada. Se muestra siempre como texto (nunca como HTML): React la
 * escapa y va en un `<q>`.
 */
export function Cita({ cita }: { cita: string }) {
  const texto = cita.trim();
  if (!texto) return null;
  return (
    <details className="text-xs text-fg-muted" data-testid="ficha-cita">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
        {T.cita.rotulo}
      </summary>
      <blockquote className="mt-1 border-l-2 border-line pl-2 break-words whitespace-pre-wrap italic">
        «{texto}»
      </blockquote>
    </details>
  );
}

function Bloque({
  id,
  titulo,
  children,
}: {
  id: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      data-testid={id}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line p-4 text-sm"
    >
      <h2 id={`${id}-titulo`} className="font-display text-base font-bold">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Lista({ items }: { items: readonly FichaDato[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((d, i) => (
        <li key={`${i}|${d.texto}`} className="flex min-w-0 flex-col">
          <span className="break-words">{d.texto}</span>
          <Cita cita={d.cita} />
        </li>
      ))}
    </ul>
  );
}

/** «La oferta en pocas palabras»: 2 o 3 frases del aviso, en español. */
export function PocasPalabras({ view }: { view: FichaView }) {
  if (!view.resumen) return null;
  return (
    <Bloque id="ficha-resumen" titulo={T.pocasPalabras.titulo}>
      <p className="break-words">{view.resumen.texto}</p>
      <Cita cita={view.resumen.cita} />
    </Bloque>
  );
}

/** «Qué vas a hacer». Sin tareas en el aviso: «No especificado». */
export function QueVasAHacer({ view }: { view: FichaView }) {
  return (
    <Bloque id="ficha-tareas" titulo={T.queVasAHacer.titulo}>
      {view.tareas.length ? (
        <Lista items={view.tareas} />
      ) : (
        <p className="text-fg-subtle">{T.queVasAHacer.vacio}</p>
      )}
    </Bloque>
  );
}

function Grupo({ titulo, items, id }: { titulo: string; items: FichaRequisito[]; id: string }) {
  if (!items.length) return null;
  return (
    <div data-testid={id} className="flex flex-col gap-1">
      <h3 className="text-xs font-bold text-fg-muted">{titulo}</h3>
      <Lista items={items} />
    </div>
  );
}

/** «Qué buscan»: indispensable y deseable solo si el aviso los distingue. */
export function QueBuscan({ view }: { view: FichaView }) {
  const b = view.buscan;
  const hay = b.todos.length + b.indispensables.length + b.deseables.length > 0;
  return (
    <Bloque id="ficha-requisitos" titulo={T.queBuscan.titulo}>
      {!hay ? (
        <p className="text-fg-subtle">{T.queBuscan.vacio}</p>
      ) : b.distingue ? (
        <>
          <Grupo
            id="ficha-indispensables"
            titulo={T.queBuscan.indispensable}
            items={b.indispensables}
          />
          <Grupo id="ficha-deseables" titulo={T.queBuscan.deseable} items={b.deseables} />
        </>
      ) : (
        <>
          <p className="text-xs text-fg-muted">{T.queBuscan.sinDistinguir}</p>
          <Lista items={b.todos} />
        </>
      )}
    </Bloque>
  );
}

/** Esqueleto con la altura del bloque real: al llegar la ficha la página no se mueve. */
function Esqueleto() {
  return (
    <div aria-hidden="true" className="flex min-h-40 flex-col gap-2 motion-safe:animate-pulse">
      <div className="h-4 w-1/3 rounded-control bg-surface-muted" />
      <div className="h-4 w-full rounded-control bg-surface-muted" />
      <div className="h-4 w-11/12 rounded-control bg-surface-muted" />
      <div className="h-4 w-2/3 rounded-control bg-surface-muted" />
    </div>
  );
}

/**
 * Estados de la ficha que no es «lista»: preparando (esqueleto y refresco solo), error con
 * reintento, sin descripción y tope. `apagada` no muestra nada (la R30 tal cual).
 * `retryAction` es la action de servidor de `ficha` (R31-03); sin ella, no hay botón.
 */
export function FichaEstadoView({
  status,
  jobId,
  retryAction,
}: {
  status: Exclude<FichaEstado, "lista" | "apagada">;
  jobId: string;
  retryAction?: (formData: FormData) => Promise<void>;
}) {
  return (
    <section
      aria-label={T.pocasPalabras.titulo}
      data-testid="ficha-estado"
      data-estado={status}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line p-4 text-sm"
    >
      {status === "preparando" ? (
        <>
          <p role="status" className="font-semibold">
            {T.estados.preparando}
          </p>
          <p className="text-xs text-fg-muted">{T.estados.preparandoAyuda}</p>
          <Esqueleto />
          <AutoRefresh active />
        </>
      ) : status === "fallida" ? (
        <>
          <p role="alert" className="font-semibold">
            {T.estados.error}
          </p>
          {retryAction ? (
            <form action={retryAction}>
              <input type="hidden" name="jobId" value={jobId} />
              <SubmitButton
                pendingLabel={T.estados.reintentando}
                className={buttonClasses({ size: "sm", variant: "secondary" })}
              >
                {T.estados.reintentar}
              </SubmitButton>
            </form>
          ) : null}
        </>
      ) : status === "sin_texto" ? (
        <>
          <p className="font-semibold">{T.estados.sinTexto}</p>
          <Link
            href="/jobs/pending-jd"
            className={`${buttonClasses({ size: "sm", variant: "secondary" })} w-fit`}
          >
            {T.estados.pegar}
          </Link>
        </>
      ) : (
        <p role="status">{T.estados.tope}</p>
      )}
    </section>
  );
}
