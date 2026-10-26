import Link from "next/link";
import { CopyButton } from "./copy-button";

const OTHER_PORTALS = ["Bumeran", "ZonaJobs", "Indeed"] as const;

const LINK_CLASS =
  "inline-flex min-h-11 items-center underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900";

/**
 * «Tu email de alertas»: suscribir la alerta del portal directamente con la dirección de la app.
 * Computrabajo la permite sin cuenta (con confirmación por email); los otros portales piden cuenta.
 * Todo es texto y links que abre el navegador de la persona (ADR-004). Computrabajo no tiene una
 * URL de búsqueda estable en `searchUrlFor`, así que no hay link para abrirlo. Sin promesas: el email
 * llega a `/inbox` y se procesa cuando haya lector para ese portal.
 */
export function AlertEmail({ address, legacy }: { address: string | null; legacy: boolean }) {
  return (
    <section
      data-testid="alert-email"
      aria-labelledby="alert-email-title"
      className="flex flex-col gap-3 rounded-md border border-zinc-900 px-3 py-3"
    >
      <h2 id="alert-email-title" className="text-lg font-semibold text-zinc-900">
        Tu email de alertas
      </h2>
      <p className="text-sm text-zinc-700">
        Suscribí las alertas de los portales directamente con esta dirección. Los avisos llegan a tu
        bandeja de Job Search sin pasar por tu correo.
      </p>
      {legacy ? (
        <div role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            Tu dirección es de un formato anterior: generá una nueva en Ajustes › Email entrante
            antes de suscribir alertas.
          </p>
          <Link href="/settings" className={`${LINK_CLASS} w-fit`}>
            Ir a Ajustes
          </Link>
        </div>
      ) : null}
      <ol
        className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-zinc-700"
        aria-label="Pasos para tu email de alertas"
      >
        <li data-testid="alert-email-step-1" className="flex flex-col gap-2">
          <h3 className="font-medium text-zinc-900">Paso 1: Copiá tu dirección de alertas.</h3>
          {address ? (
            <div className="flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2">
              <p className="min-w-0 flex-1 font-mono text-sm break-all select-all">
                <span data-testid="assistant-address">{address}</span>
              </p>
              <CopyButton text={address} />
            </div>
          ) : (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Todavía no tenés una dirección de reenvío. Generá una en Ajustes.
            </p>
          )}
        </li>
        <li data-testid="alert-email-step-2" className="flex flex-col gap-1">
          <h3 className="font-medium text-zinc-900">Paso 2: Creá la alerta en Computrabajo.</h3>
          <p>
            En Computrabajo, buscá el puesto, tocá <span className="font-medium">Crear alerta</span>{" "}
            y pegá tu dirección. No hace falta crear una cuenta.
          </p>
        </li>
        <li data-testid="alert-email-step-3" className="flex flex-col gap-1">
          <h3 className="font-medium text-zinc-900">Paso 3: Confirmá desde tu bandeja.</h3>
          <p>
            Computrabajo te manda un email para confirmar. Abrilo en tu bandeja y tocá el link de
            confirmación.
          </p>
          <Link href="/inbox" className={`${LINK_CLASS} w-fit`}>
            Ir a mi bandeja
          </Link>
        </li>
      </ol>
      <div className="flex flex-col gap-1 text-sm text-zinc-700">
        <p>
          Bumeran, ZonaJobs e Indeed piden una cuenta para crear alertas. Mientras tanto, usá{" "}
          <span className="font-medium">Pegar el aviso</span> con las ofertas que te interesen.
        </p>
        <ul data-testid="alert-email-other-portals" className="m-0 flex list-none flex-col p-0">
          {OTHER_PORTALS.map((name) => (
            <li key={name} className="flex flex-wrap items-center gap-x-2">
              <span>
                <span className="font-medium">{name}:</span> piden cuenta.
              </span>
              <Link
                href="/jobs/new?modo=pegar"
                className={LINK_CLASS}
                aria-label={`Pegar el aviso (${name})`}
              >
                Pegar el aviso
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p role="note" className="text-sm text-zinc-600">
        Por ahora leemos automáticamente las alertas de algunos portales. Las de Computrabajo llegan
        a tu bandeja y las procesamos cuando sumemos su lector.
      </p>
    </section>
  );
}
