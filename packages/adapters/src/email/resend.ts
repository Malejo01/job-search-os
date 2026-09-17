/**
 * Envío saliente por Resend (REST, sin SDK — mismo estilo que inbound/resend.ts). Sin un
 * dominio propio verificado en Resend, `from` tiene que ser el sandbox `onboarding@resend.dev`,
 * que solo entrega al email de la cuenta de Resend (alcanza para un solo usuario, JS-045).
 */
export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  from?: string;
};

const DEFAULT_FROM = "Job Search OS <onboarding@resend.dev>";

export async function sendEmail(
  params: SendEmailParams,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: params.from ?? DEFAULT_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend POST /emails: HTTP ${res.status} ${await res.text()}`);
}
