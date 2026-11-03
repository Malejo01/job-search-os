import {
  buildWelcomeEmail,
  cvChatMode,
  parseContactEmail,
  type PlanSource,
} from "@job-search-os/pipeline";
import { resetUrlBase } from "../auth/reset-url";
import { sendEmail, type SendEmailParams } from "../email/resend";

/**
 * Email de bienvenida al activar el plan de la beta (C8-7). Lo llama la acción de /settings/planes con
 * `after()`, así el panel no espera a Resend. Quién recibe y cuándo lo decide la web
 * (`isPlanActivation`, pipeline); acá solo el orden seguro:
 *   1. Apagado salvo `WELCOME_EMAIL_ENABLED=1`.
 *   2. Sin `RESEND_API_KEY` y `EMAIL_FROM` (el mismo remitente y la misma cuenta de Resend que los avisos
 *      de vencimiento) o sin URL base, no manda nada.
 *   3. Un error de Resend no rompe nada: se loguea solo el código HTTP (el cuerpo puede traer el email).
 * Los logs llevan solo `user_id` del admin y el resultado: nunca el email ni el nombre de la persona.
 */
export type WelcomeEmailLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
};

export type WelcomeEmailResult = "enviado" | "apagado" | "sin_resend" | "sin_url" | "fallo";

export async function sendWelcomeEmail(deps: {
  to: string;
  displayName?: string;
  until: Date;
  source: PlanSource;
  env: Record<string, string | undefined>;
  logger: WelcomeEmailLogger;
  send?: (params: SendEmailParams, apiKey: string) => Promise<void>;
}): Promise<WelcomeEmailResult> {
  const { env, logger } = deps;
  if (env.WELCOME_EMAIL_ENABLED !== "1") return "apagado";
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    logger.warn({}, "bienvenida: faltan RESEND_API_KEY o EMAIL_FROM; no se manda");
    return "sin_resend";
  }
  const base = resetUrlBase(env);
  if (!base.ok) {
    logger.warn({ reason: base.error }, "bienvenida: sin URL base; no se manda");
    return "sin_url";
  }
  const email = buildWelcomeEmail({
    displayName: deps.displayName ?? "",
    until: deps.until,
    becado: deps.source === "beca",
    appUrl: base.url,
    contactEmail: parseContactEmail(env.CONTACT_EMAIL),
    cvEnabled: cvChatMode(env) === "all",
  });
  const send = deps.send ?? ((params, key) => sendEmail(params, key));
  try {
    await send(
      { to: deps.to, from, subject: email.subject, text: email.text, html: email.html },
      apiKey,
    );
    logger.info({ source: deps.source }, "bienvenida: enviada");
    return "enviado";
  } catch (error) {
    const match = /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "");
    logger.warn({ status: match ? Number(match[1]) : null }, "bienvenida: falló el envío");
    return "fallo";
  }
}
