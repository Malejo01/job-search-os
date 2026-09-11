import { z } from "zod";

/** Evento `email.received` de Resend (docs/webhooks/emails/received). */
export const ResendReceivedEventSchema = z.object({
  type: z.literal("email.received"),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    created_at: z.string().optional(),
    from: z.string(),
    to: z.array(z.string()).default([]),
    cc: z.array(z.string()).default([]),
    bcc: z.array(z.string()).default([]),
    received_for: z.array(z.string()).default([]),
    message_id: z.string().optional(),
    subject: z.string().nullable().optional(),
    attachments: z
      .array(z.object({ id: z.string(), filename: z.string().optional() }).passthrough())
      .default([]),
  }),
});
export type ResendReceivedEvent = z.infer<typeof ResendReceivedEventSchema>;

/** Cualquier otro evento (email.sent, etc.): se responde 200 y se ignora. */
export const ResendAnyEventSchema = z.object({ type: z.string() }).passthrough();

export type ReceivedEmailContent = {
  html: string | null;
  text: string | null;
  headers: Record<string, string> | null;
};

/**
 * GET /emails/receiving/{id}: el webhook solo trae metadatos; el cuerpo se pide por API.
 * Sin RESEND_API_KEY se guarda solo el evento (los parsers no pueden correr).
 */
export async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmailContent> {
  const res = await fetchImpl(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  if (!res.ok) throw new Error(`Resend GET /emails/receiving/${emailId}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    html?: string | null;
    text?: string | null;
    headers?: Record<string, string> | null;
  };
  return { html: json.html ?? null, text: json.text ?? null, headers: json.headers ?? null };
}
