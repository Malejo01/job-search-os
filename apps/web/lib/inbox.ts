import { pgBlobStorage } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { baseDomain, senderHost } from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Contenido crudo de un email entrante (JS-020). El webhook guarda en `raw_blobs` un JSON
 * `{ event, content }`; acá se saca el HTML y el texto para poder leerlos desde /inbox cuando
 * el email cayó en la cola manual y hay que decidir si se carga a mano o si merece un parser.
 */
export type InboundEmailDetail = {
  id: string;
  from: string;
  subject: string | null;
  parser: string | null;
  jobsExtracted: number | null;
  error: string | null;
  receivedAt: Date;
  /** JS-038: estado en /inbox, para las acciones del detalle. */
  seen: boolean;
  dismissed: boolean;
  html: string | null;
  text: string | null;
  /** Links del email, para poder abrirlos sin depender del HTML embebido. */
  links: string[];
  /** JS-051: remitente no esperado, se guardó sin cuerpo. El motivo, o null si está completo. */
  redacted: string | null;
  /** Dominio base del remitente, para marcarlo como fuente de empleo. */
  senderDomain: string | null;
  /** El dominio ya está marcado como fuente de empleo: los próximos se guardan completos. */
  senderIsJobSource: boolean;
};

/** Texto visible de un HTML, para cuando el email no trae parte de texto plano. */
export function htmlAPlano(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extraerLinks(texto: string, html: string | null): string[] {
  const urls = new Set<string>();
  for (const m of texto.matchAll(/https?:\/\/[^\s"'<>)]+/g)) urls.add(m[0]);
  if (html) for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) urls.add(m[1]!);
  return [...urls].slice(0, 30);
}

export async function getInboundEmail(
  userId: string,
  id: string,
): Promise<InboundEmailDetail | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, id))
      .limit(1);
    if (!row) return null;

    const blob = await pgBlobStorage(tx).get(row.rawRef);
    let html: string | null = null;
    let text: string | null = null;
    let redacted: string | null = null;
    if (blob) {
      try {
        const parsed = JSON.parse(blob.body) as {
          content?: { html?: string | null; text?: string | null } | null;
          redacted?: string;
        };
        html = parsed.content?.html ?? null;
        text = parsed.content?.text ?? null;
        redacted = parsed.redacted ?? null;
      } catch {
        text = blob.body; // crudo no-JSON: se muestra tal cual
      }
    }
    const plano = text ?? (html ? htmlAPlano(html) : "");
    const host = senderHost(row.fromAddress);
    const senderDomain = host ? baseDomain(host) : null;
    const [verdict] = senderDomain
      ? await tx
          .select({ verdict: s.inboundSenderDomains.verdict })
          .from(s.inboundSenderDomains)
          .where(
            and(
              eq(s.inboundSenderDomains.userId, userId),
              eq(s.inboundSenderDomains.domain, senderDomain),
            ),
          )
      : [];
    return {
      id: row.id,
      from: row.fromAddress,
      subject: row.subject,
      parser: row.parser,
      jobsExtracted: row.jobsExtracted,
      error: row.error,
      receivedAt: row.receivedAt,
      seen: row.seenAt !== null,
      dismissed: row.dismissedAt !== null,
      html,
      text: plano || null,
      links: extraerLinks(plano, html),
      redacted,
      senderDomain,
      senderIsJobSource: verdict?.verdict === "empleo",
    };
  });
}
