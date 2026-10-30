import { buildEmailFrameDoc, isWebmailDomain } from "@job-search-os/pipeline";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { webmailErrorFromParams } from "@/lib/filter-leak";
import { getInboundEmail } from "@/lib/inbox";
import { markInboundSeen } from "@/lib/inbox-list";
import { formatDate, inboundErrorLabel, parserLabel } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { EmailActions } from "../email-actions";
import { senderVerdictAction } from "../leak-actions";

export const metadata = { title: "Email" };
export const dynamic = "force-dynamic";

/**
 * Un email entrante como en un cliente de correo (JS-020, JS-039): encabezado, acciones arriba
 * (las mismas que la lista de /inbox) y un solo cuerpo. Si hay HTML se muestra el HTML; si no,
 * el texto. El texto plano y los links quedan plegados como alternativa ("ver original").
 * Abrirlo lo marca visto, como en un cliente de correo.
 *
 * El HTML del email es contenido NO confiable: va dentro de un iframe con `sandbox` vacío, sin
 * scripts, sin formularios y sin poder navegar la página que lo contiene. Ojo: sus links SÍ
 * navegan el propio iframe al hacer click (no hay scripts ni formularios, pero un link es un
 * link); la CSP corta el pedido de red del contenido, no la navegación por click. `buildEmailFrameDoc` agrega la CSP y los estilos de
 * lectura (ancho del celular) y le saca el `meta refresh` y el `base`.
 */
export default async function InboundEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sender?: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;
  const webmailError = webmailErrorFromParams(await searchParams);
  if (!isUuid(id)) notFound();
  const email = await getInboundEmail(userId, id);
  if (!email) notFound();
  // Abrirlo es leerlo: sale de pendientes. No pisa un "no me sirve" ni la fecha de un visto previo.
  if (!email.seen && !email.dismissed) {
    await markInboundSeen(userId, email.id);
    email.seen = true;
  }

  return (
    <article className="flex flex-col gap-3">
      <Link href="/inbox" className="text-xs text-fg-subtle underline">
        ← Emails entrantes
      </Link>

      {webmailError ? (
        <p
          role="alert"
          data-testid="error-webmail"
          className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {webmailError}
        </p>
      ) : null}

      <header className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
        <h1 className="text-lg font-semibold leading-snug">{email.subject ?? "(sin asunto)"}</h1>
        <div className="text-xs text-fg-subtle">
          <p className="break-all">{email.from}</p>
          <p>
            {formatDate(email.receivedAt.toISOString())} · {parserLabel(email.parser)} ·{" "}
            {email.jobsExtracted ?? 0} avisos
            {email.dismissed ? " · no me sirve" : email.seen ? " · visto" : ""}
          </p>
        </div>
        {email.error ? (
          <p className="text-xs text-warning">
            {inboundErrorLabel(email.error)}{" "}
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

      {email.redacted ? (
        // JS-051: remitente no esperado. El contenido nunca se guardó, por privacidad
        <section
          aria-label="Cuerpo no guardado"
          className="flex flex-col gap-2 rounded-card border border-line-strong bg-surface-subtle p-3 text-sm text-fg-muted"
        >
          <p>
            Por privacidad no se guardó el cuerpo: el remitente no es una fuente de empleo esperada.
            Solo quedan el remitente, el asunto y la fecha.
          </p>
          {email.senderDomain ? (
            email.senderIsJobSource ? (
              <p className="text-xs text-success">
                Los próximos emails de {email.senderDomain} se guardan completos. Este queda así.
              </p>
            ) : isWebmailDomain(email.senderDomain) ? (
              <p className="text-xs text-fg-muted">
                Correo personal: no se puede marcar como fuente
              </p>
            ) : (
              <form action={senderVerdictAction}>
                <input type="hidden" name="domain" value={email.senderDomain} />
                <input type="hidden" name="verdict" value="empleo" />
                <input type="hidden" name="back" value={`/inbox/${email.id}`} />
                <button
                  type="submit"
                  className="rounded-control border border-line-control bg-surface px-2 py-1 text-xs"
                >
                  Marcar {email.senderDomain} como fuente de empleo
                </button>
              </form>
            )
          ) : null}
        </section>
      ) : email.html ? (
        <iframe
          title="Contenido del email"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={buildEmailFrameDoc(email.html)}
          // Blanco también en oscuro, a propósito: el HTML del email trae sus propios colores (casi
          // siempre texto oscuro sin fondo) y sobre `bg-surface` oscuro no se leería
          className="h-[75vh] w-full rounded-card border border-line bg-white [color-scheme:light]"
        />
      ) : email.text ? (
        <div className="rounded-card border border-line bg-surface p-3">
          <p className="max-h-[75vh] overflow-auto text-sm break-words whitespace-pre-wrap text-fg">
            {email.text}
          </p>
        </div>
      ) : (
        <p className="rounded-card border border-dashed border-line-strong p-6 text-center text-sm text-fg-subtle">
          No se guardó el cuerpo de este email (llegó sin `RESEND_API_KEY` configurada).
        </p>
      )}

      {email.html && email.text ? (
        <details className="rounded-card border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm text-fg-muted">Ver como texto plano</summary>
          <pre className="mt-2 max-h-[60vh] overflow-auto text-xs break-words whitespace-pre-wrap text-fg">
            {email.text}
          </pre>
        </details>
      ) : null}

      {email.links.length > 0 ? (
        <details className="rounded-card border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer text-fg-muted">
            Links del email ({email.links.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {email.links.map((href) => (
              <li key={href} className="break-all">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-xs text-link underline"
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
