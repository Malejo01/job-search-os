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

/** Tiempo máximo para pedir el cuerpo: el webhook tiene 60 s en total. */
export const RESEND_FETCH_TIMEOUT_MS = 10_000;

/** `retryable`: falla pasajera (429, 5xx, red o tiempo agotado); conviene que el webhook se reintente. */
export class ResendFetchError extends Error {
  constructor(
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(`Resend GET /emails/receiving: ${status === null ? "sin respuesta" : `HTTP ${status}`}`);
    this.name = "ResendFetchError";
  }
}

/** 401 y 403 (clave revocada o mal rotada) se reintentan: perder el cuerpo con un 200 sería silencioso. */
const CONFIG_ERROR_STATUSES: readonly number[] = [401, 403];
const isRetryableStatus = (status: number): boolean =>
  status === 429 || status >= 500 || CONFIG_ERROR_STATUSES.includes(status);

/**
 * GET /emails/receiving/{id}: el webhook solo trae metadatos; el cuerpo se pide por API.
 * Sin RESEND_API_KEY se guarda solo el evento (los parsers no pueden correr).
 */
export async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmailContent> {
  let res: Response;
  try {
    res = await fetchImpl(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    throw new ResendFetchError(null, true);
  }
  if (!res.ok) {
    throw new ResendFetchError(res.status, isRetryableStatus(res.status));
  }
  let json: {
    html?: string | null;
    text?: string | null;
    headers?: Record<string, string> | null;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    // Tiempo agotado a mitad de la descarga, conexión cortada o JSON truncado: pasajero
    throw new ResendFetchError(null, true);
  }
  return { html: json.html ?? null, text: json.text ?? null, headers: json.headers ?? null };
}

/**
 * Cuerpo del email para el webhook. Una falla pasajera se relanza para responder 500 y que se reintente;
 * si el email no se puede recuperar, sigue sin cuerpo y queda en la cola manual.
 */
export async function loadInboundContent(
  emailId: string,
  apiKey: string,
  logger: {
    warn: (context: object, message: string) => void;
    error?: (context: object, message: string) => void;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmailContent | null> {
  try {
    return await fetchReceivedEmail(emailId, apiKey, fetchImpl);
  } catch (e) {
    if (e instanceof ResendFetchError && CONFIG_ERROR_STATUSES.includes(e.status ?? 0)) {
      // Error de configuración: solo el código de estado, nunca la clave ni el id del email
      logger.error?.(
        { status: e.status },
        "inbound: Resend rechazó la clave de API (revisar RESEND_API_KEY)",
      );
    }
    if (e instanceof ResendFetchError && e.retryable) throw e;
    logger.warn({ status: e instanceof ResendFetchError ? e.status : null }, "inbound: sin cuerpo");
    return null;
  }
}
