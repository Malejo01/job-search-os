import Link from "next/link";
import { Alert, alertClasses, buttonClasses, cardClasses, textLinkClasses } from "@/components/ui";
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
    <section className={cardClasses({ padding: "md", className: "flex flex-col gap-3" })}>
      <h2 className="text-heading font-bold">Email entrante</h2>
      {notice === "nueva" ? (
        <Alert tone="success" role="status">
          Dirección nueva generada. La anterior ya no funciona: actualizá el filtro de Gmail.
        </Alert>
      ) : null}
      {notice === "sin_dominio" ? (
        <Alert tone="warning" role="alert">
          No se pudo generar la dirección: falta configurar el dominio de ingesta. No cambió nada.
        </Alert>
      ) : null}
      <p className="text-sm text-fg-muted">
        Reenviá a esta dirección las alertas de empleo y se cargan solas. Es personal: no la
        compartas.
      </p>
      <p className="rounded-control bg-surface-muted px-4 py-3 font-mono text-sm break-all select-all">
        <span data-testid="inbound-address">{address ?? "—"}</span>
      </p>
      <details className="text-sm text-fg-muted">
        <summary className="cursor-pointer font-bold text-fg">Cómo reenviar desde Gmail</summary>
        <ol className="mt-2 list-decimal pl-5">
          <li>
            En Gmail: Configuración › Reenvío y correo POP/IMAP › Añadir una dirección de reenvío, y
            pegá la dirección de arriba.
          </li>
          <li>
            Gmail manda un pedido de confirmación a esa dirección. Aparece arriba de todo en{" "}
            <Link href="/inbox" className={textLinkClasses()}>
              Emails
            </Link>
            , con el botón «Confirmar reenvío».
          </li>
          <li>
            Creá un filtro solo para las alertas de LinkedIn y de Get on Board (por remitente) con
            las acciones «Reenviar a» y «Omitir Recibidos (archivarlo)», así las alertas no ensucian
            tu bandeja. No reenvíes el resto de tu correo.
          </li>
        </ol>
      </details>
      {legacy ? (
        <p className={alertClasses({ tone: "warning" })}>
          Tu dirección es de un formato anterior, más fácil de adivinar: generá una nueva y
          actualizá el filtro de Gmail.
        </p>
      ) : null}
      <details className="rounded-control bg-surface-subtle px-4 py-1 text-sm text-fg-muted">
        <summary className="cursor-pointer font-bold text-fg">Generar una dirección nueva</summary>
        <div className="mt-2 mb-3 flex flex-col gap-3">
          <p>
            La dirección actual deja de funcionar al instante: lo que llegue a ella se rechaza.
            Después tenés que actualizar el reenvío y el filtro de Gmail con la nueva.
          </p>
          <form action={rotateInboundAddressAction}>
            <button type="submit" className={buttonClasses()}>
              Sí, generar una dirección nueva
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
