/**
 * Envío saliente por Resend (REST, sin SDK — mismo estilo que inbound/resend.ts). Sin un
 * dominio propio verificado en Resend, `from` tiene que ser el sandbox `onboarding@resend.dev`,
 * que solo entrega al email de la cuenta de Resend (alcanza para un solo usuario, JS-045).
 */
import { PRODUCT_NAME } from "@job-search-os/pipeline";

export type SendEmailParams = {
  to: string;
  subject: string;
  /** Cuerpo HTML. Hace falta `html` o `text` (o los dos). */
  html?: string;
  /** Cuerpo en texto simple (los avisos de vencimiento del plan, C4-1). */
  text?: string;
  from?: string;
};

const DEFAULT_FROM = `${PRODUCT_NAME} <onboarding@resend.dev>`;

export async function sendEmail(
  params: SendEmailParams,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (params.html === undefined && params.text === undefined) {
    throw new Error("sendEmail: falta el cuerpo (html o text)");
  }
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: params.from ?? DEFAULT_FROM,
      to: [params.to],
      subject: params.subject,
      ...(params.html !== undefined ? { html: params.html } : {}),
      ...(params.text !== undefined ? { text: params.text } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend POST /emails: HTTP ${res.status} ${await res.text()}`);
}
