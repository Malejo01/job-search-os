import Link from "next/link";
import { notFound } from "next/navigation";
import { getInboundEmail } from "@/lib/inbox";
import { markInboundSeen } from "@/lib/inbox-list";
import { formatDate, parserLabel } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { EmailActions } from "../email-actions";

export const dynamic = "force-dynamic";

/**
 * Estilos que se agregan al HTML del email para que se lea en el ancho del celular (tablas de
 * 600 px, imágenes grandes). Van dentro del mismo iframe aislado: no tocan la página.
 */
const LECTURA = `<meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0;padding:12px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.45;color:#18181b;background:#fff;word-wrap:break-word}
img{max-width:100%;height:auto}table{max-width:100%!important;width:auto}td,th{word-break:break-word}
</style>`;

/**
 * Un email entrante como en un cliente de correo (JS-020, JS-039): encabezado, acciones arriba
 * (las mismas que la lista de /inbox) y un solo cuerpo. Si hay HTML se muestra el HTML; si no,
 * el texto. El texto plano y los links quedan plegados como alternativa ("ver original").
 * Abrirlo lo marca visto, como en un cliente de correo.
 *
 * El HTML del email es contenido NO confiable: va dentro de un iframe con `sandbox` vacío, sin
 * scripts, sin formularios y sin poder navegar la página que lo contiene. Por eso sus links no
 * se abren desde adentro; se listan aparte.
 */
export default async function InboundEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const email = await getInboundEmail(userId, id);
  if (!email) notFound();
  // Abrirlo es leerlo: sale de pendientes. No pisa un "no me sirve" ni la fecha de un visto previo.
  if (!email.seen && !email.dismissed) {
    await markInboundSeen(userId, email.id);
    email.seen = true;
  }

  return (
    <article className="flex flex-col gap-3">
      <Link href="/inbox" className="text-xs text-zinc-600 underline">
        ← Emails entrantes
      </Link>

      <header className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
        <h1 className="text-lg font-semibold leading-snug">{email.subject ?? "(sin asunto)"}</h1>
        <div className="text-xs text-zinc-600">
          <p className="break-all">{email.from}</p>
          <p>
            {formatDate(email.receivedAt.toISOString())} · {parserLabel(email.parser)} ·{" "}
            {email.jobsExtracted ?? 0} avisos
            {email.dismissed ? " · no me sirve" : email.seen ? " · visto" : ""}
          </p>
        </div>
        {email.error ? (
          <p className="text-xs text-amber-900">
            {email.error}{" "}
            <Link href="/jobs/new" className="underline">
              cargar a mano
            </Link>
          </p>
        ) : null}
        <EmailActions
          id={email.id}
          subject={email.subject}
          seen={email.seen}
          dismissed={email.dismissed}
          volver
        />
      </header>

      {email.html ? (
        <iframe
          title="Contenido del email"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={`${LECTURA}${email.html}`}
          className="h-[75vh] w-full rounded-lg border border-zinc-200 bg-white"
        />
      ) : email.text ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="max-h-[75vh] overflow-auto text-sm break-words whitespace-pre-wrap text-zinc-800">
            {email.text}
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          No se guardó el cuerpo de este email (llegó sin `RESEND_API_KEY` configurada).
        </p>
      )}

      {email.html && email.text ? (
        <details className="rounded-lg border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm text-zinc-700">Ver como texto plano</summary>
          <pre className="mt-2 max-h-[60vh] overflow-auto text-xs break-words whitespace-pre-wrap text-zinc-800">
            {email.text}
          </pre>
        </details>
      ) : null}

      {email.links.length > 0 ? (
        <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer text-zinc-700">
            Links del email ({email.links.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {email.links.map((href) => (
              <li key={href} className="break-all">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-xs text-blue-700 underline"
                >
                  {href}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
