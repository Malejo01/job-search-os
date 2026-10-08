import Link from "next/link";
import { rotateInboundAddressAction } from "./actions";

/**
 * Sección «Email entrante» de Ajustes (JS-095): la dirección del usuario, cómo reenviar las alertas
 * desde Gmail y el botón para generar una nueva (en dos pasos: abrir el desplegable y confirmar).
 */
export function InboundAddressSection({
  address,
  notice,
  legacy = false,
}: {
  address: string | null;
  /** La dirección es la derivada del id (formato anterior). */
  legacy?: boolean;
  notice?: "nueva" | "sin_dominio";
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
      <h2 className="text-lg font-medium">Email entrante</h2>
      {notice === "nueva" ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Dirección nueva generada. La anterior ya no funciona: actualizá el filtro de Gmail.
        </p>
      ) : null}
      {notice === "sin_dominio" ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No se pudo generar la dirección: falta configurar el dominio de ingesta. No cambió nada.
        </p>
      ) : null}
      <p className="text-sm text-zinc-700">
        Reenviá a esta dirección las alertas de empleo y se cargan solas. Es personal: no la
        compartas.
      </p>
      <p className="break-all rounded-md bg-zinc-100 px-3 py-2 font-mono text-sm select-all">
        <span data-testid="inbound-address">{address ?? "—"}</span>
      </p>
      <details className="text-sm text-zinc-700">
        <summary className="cursor-pointer font-medium">Cómo reenviar desde Gmail</summary>
        <ol className="mt-2 list-decimal pl-5">
          <li>
            En Gmail: Configuración › Reenvío y correo POP/IMAP › Añadir una dirección de reenvío, y
            pegá la dirección de arriba.
          </li>
          <li>
            Gmail manda un link de confirmación a esa dirección. Lo vas a encontrar en{" "}
            <Link href="/inbox" className="underline">
              Emails
            </Link>{" "}
            › «Ver contenido» › «Links».
          </li>
          <li>
            Creá un filtro solo para las alertas de LinkedIn y de Get on Board (por remitente) con
            la acción «Reenviar a». No reenvíes el resto de tu correo.
          </li>
        </ol>
      </details>
      {legacy ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Tu dirección es de un formato anterior, más fácil de adivinar: generá una nueva y
          actualizá el filtro de Gmail.
        </p>
      ) : null}
      <details className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-700">
        <summary className="cursor-pointer font-medium">Generar una dirección nueva</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p>
            La dirección actual deja de funcionar al instante: lo que llegue a ella se rechaza.
            Después tenés que actualizar el reenvío y el filtro de Gmail con la nueva.
          </p>
          <form action={rotateInboundAddressAction}>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
            >
              Sí, generar una dirección nueva
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
