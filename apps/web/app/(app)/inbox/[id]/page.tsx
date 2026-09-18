import Link from "next/link";
import { notFound } from "next/navigation";
import { getInboundEmail } from "@/lib/inbox";
import { formatDate } from "@/lib/labels";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Contenido de un email entrante (JS-020). Sirve para leer lo que cayó en la cola manual y
 * decidir: cargarlo a mano, o escribir un parser para esa fuente.
 *
 * El HTML del email es contenido NO confiable, así que va dentro de un iframe con `sandbox`
 * vacío: sin scripts, sin formularios y sin poder navegar la página que lo contiene. Los links
 * se listan aparte, como texto, para poder abrirlos sin depender de ese HTML.
 */
export default async function InboundEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const email = await getInboundEmail(userId, id);
  if (!email) notFound();

  return (
    <section className="flex flex-col gap-3">
      <Link href="/inbox" className="text-xs text-zinc-600 underline">
        ← Emails entrantes
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{email.subject ?? "(sin asunto)"}</h1>
        <p className="text-xs text-zinc-600">
          {email.from} · {formatDate(email.receivedAt.toISOString())} · parser{" "}
          {email.parser ?? "none"} · {email.jobsExtracted ?? 0} avisos
        </p>
        {email.error ? (
          <p className="mt-1 text-xs text-amber-900">
            {email.error}{" "}
            <Link href="/jobs/new" className="underline">
              cargar a mano
            </Link>
          </p>
        ) : null}
      </div>

      {email.links.length > 0 ? (
        <details className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium">Links ({email.links.length})</summary>
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

      {email.text ? (
        <details open={!email.html} className="rounded-lg border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium">Texto</summary>
          <pre className="mt-2 max-h-[60vh] overflow-auto text-xs break-words whitespace-pre-wrap text-zinc-800">
            {email.text}
          </pre>
        </details>
      ) : null}

      {email.html ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          <p className="mb-2 text-sm font-medium">HTML del email</p>
          <iframe
            title="Contenido del email"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={email.html}
            className="h-[70vh] w-full rounded border border-zinc-200 bg-white"
          />
        </div>
      ) : null}

      {!email.text && !email.html ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
          No se guardó el cuerpo de este email (llegó sin `RESEND_API_KEY` configurada).
        </p>
      ) : null}
    </section>
  );
}
