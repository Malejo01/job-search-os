import { isLegacyInboundAddress } from "@job-search-os/pipeline";
import Link from "next/link";
import { CopyButton } from "./copy-button";

const LEGACY_NOTICE =
  "Tu dirección es de un formato anterior: generá una nueva en Ajustes › Email entrante antes de configurar Gmail.";

/**
 * Asistente de reenvío (compartido por el onboarding y Ajustes): la dirección, el alta del reenvío
 * en Gmail y la descarga del archivo de filtros. Todo es texto y links: nada se abre desde el servidor.
 */
export function Assistant({ address, userId }: { address: string | null; userId: string }) {
  const legacy =
    address !== null &&
    (isLegacyInboundAddress(address, userId) || !/^u_[a-z2-7]{20}@/.test(address));
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Conectá tus alertas de empleo</h1>
      <p className="text-sm text-zinc-700">
        Reenviá las alertas de LinkedIn, Get on Board e Indeed a tu dirección personal y se cargan
        solas. No la compartas.
      </p>
      {legacy ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {LEGACY_NOTICE}{" "}
          <Link href="/settings" className="underline">
            Ir a Ajustes
          </Link>
        </p>
      ) : null}
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
      <ol className="flex list-none flex-col gap-4 p-0 text-sm text-zinc-700">
        <li className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-zinc-900">Paso 1: agregá el reenvío</h2>
          <p>
            Abrí{" "}
            <a
              href="https://mail.google.com/mail/u/0/#settings/fwdandpop"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Gmail › Reenvío y correo POP/IMAP
            </a>
            . Tocá «Añadir una dirección de reenvío», pegá la dirección de arriba y confirmá.
          </p>
          <p>
            Gmail te manda un pedido de confirmación a esa dirección. Lo vas a ver en tu bandeja de
            la app.
          </p>
        </li>
        <li className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-zinc-900">Paso 2: descargá tus filtros</h2>
          <p>
            {legacy ? (
              LEGACY_NOTICE
            ) : (
              <a href="/api/gmail-filters" download className="underline">
                Descargar filtros-job-search-os.xml
              </a>
            )}
          </p>
          <p>
            Después, en Gmail › Filtros y direcciones bloqueadas › «Importar filtros», elegí el
            archivo y tocá «Crear filtros». No marques «Aplicar también a las conversaciones
            existentes».
          </p>
          <p>
            El filtro reenvía todo lo que llega de esos remitentes (también avisos de cuenta de esas
            plataformas): los avisos de inicio de sesión o códigos se descartan en la app sin
            guardarse, y en Gmail quedan en Todos los mensajes.
          </p>
        </li>
        <li className="flex flex-col gap-1">
          <h2 className="text-base font-medium text-zinc-900">Paso 3: listo</h2>
          <p>Cuando llegue la próxima alerta, la vas a ver en tu bandeja.</p>
        </li>
      </ol>
      <div className="flex justify-end">
        <Link
          href="/jobs"
          className="rounded-md bg-zinc-900 px-4 py-2 text-base font-medium text-white"
        >
          Lo hago después
        </Link>
      </div>
    </section>
  );
}
