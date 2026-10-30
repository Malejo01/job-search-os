"use server";

import { createLogger, safeDbError, sendEmail } from "@job-search-os/adapters";
import {
  FEEDBACK_CATEGORY_LABELS,
  PRODUCT_NAME,
  validateFeedback,
  type FeedbackField,
  type FeedbackInput,
} from "@job-search-os/pipeline";
import { after } from "next/server";
import { saveFeedback } from "@/lib/beta-feedback";
import { requireActiveUserId } from "@/lib/session";

export type FeedbackResult = { ok: true } | { ok: false; field: FeedbackField | "_error" };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function notifyFeedbackAdmins(
  feedback: FeedbackInput,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) return;

  const from =
    process.env.EMAIL_FROM ||
    (process.env.INGEST_DOMAIN
      ? `${PRODUCT_NAME} <soporte@${process.env.INGEST_DOMAIN}>`
      : undefined);

  const categoryLabel = FEEDBACK_CATEGORY_LABELS[feedback.category] ?? feedback.category;
  const actions = feedback.context?.actions ?? [];
  const actionsHtml =
    actions.length > 0
      ? `<ul>${actions
          .map(
            (a) =>
              `<li><code>${escapeHtml(a.time)}</code> <strong>${escapeHtml(a.type)}</strong>: ${escapeHtml(a.text)}</li>`,
          )
          .join("")}</ul>`
      : "<p><em>Sin acciones previas registradas.</em></p>";

  const contextMeta = [
    feedback.context?.pageTitle
      ? `<p><strong>Título:</strong> ${escapeHtml(feedback.context.pageTitle)}</p>`
      : "",
    feedback.context?.screen
      ? `<p><strong>Pantalla:</strong> ${escapeHtml(feedback.context.screen)}</p>`
      : "",
    feedback.context?.theme
      ? `<p><strong>Tema:</strong> ${escapeHtml(feedback.context.theme)}</p>`
      : "",
    feedback.context?.userAgent
      ? `<p><strong>Navegador:</strong> ${escapeHtml(feedback.context.userAgent)}</p>`
      : "",
    feedback.context?.appVersion
      ? `<p><strong>Versión:</strong> ${escapeHtml(feedback.context.appVersion)}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const html = `
    <h2>Nuevo reporte de soporte</h2>
    <p><strong>Página:</strong> <code>${escapeHtml(feedback.path)}</code></p>
    <p><strong>Categoría:</strong> ${escapeHtml(categoryLabel)} (<code>${escapeHtml(feedback.category)}</code>)</p>
    ${contextMeta}
    <hr />
    <p><strong>Mensaje:</strong></p>
    <blockquote style="white-space: pre-wrap; background: #f4f4f5; padding: 12px; border-left: 4px solid #71717a; border-radius: 4px;">
      ${escapeHtml(feedback.message)}
    </blockquote>
    <hr />
    <h3>Últimas acciones</h3>
    ${actionsHtml}
  `;

  for (const adminEmail of adminEmails) {
    try {
      await sendEmail(
        {
          to: adminEmail,
          subject: `[Soporte] ${categoryLabel} en ${feedback.path} — ${PRODUCT_NAME}`,
          html,
          from,
        },
        apiKey,
      );
    } catch (err) {
      log.error({ admin: adminEmail, err: safeDbError(err) }, "feedback: falló envío a admin");
    }
  }
}

/**
 * «Contanos qué pasó» (C-23 / R1-9). El usuario sale de la sesión; valida categoría, mensaje, path
 * y contexto opcional (últimas acciones y entorno) y aplica el tope diario en la base. Devuelve
 * `{ ok, field }`, nunca el texto. En los logs va solo `user_id` y la categoría: el mensaje no se loguea.
 * Notifica por email a ADMIN_EMAILS en `after()`.
 */
export async function sendFeedbackAction(formData: FormData): Promise<FeedbackResult> {
  const userId = await requireActiveUserId();
  const checked = validateFeedback({
    category: formData.get("category"),
    message: formData.get("message"),
    path: formData.get("path"),
    context: formData.get("context"),
  });
  if (!checked.ok) return { ok: false, field: checked.field };
  const log = createLogger({ user_id: userId, task: "beta_feedback" });
  try {
    const saved = await saveFeedback(userId, checked.value);
    if (!saved.ok) {
      log.info({ category: checked.value.category }, "feedback: tope diario");
      return { ok: false, field: saved.field };
    }
    log.info({ category: checked.value.category }, "feedback: guardado");

    after(async () => {
      try {
        await notifyFeedbackAdmins(checked.value, log);
      } catch (err) {
        log.error({ err: safeDbError(err) }, "feedback: falló notificación de admins");
      }
    });

    return { ok: true };
  } catch (error) {
    log.error({ category: checked.value.category, err: safeDbError(error) }, "feedback: falló");
    return { ok: false, field: "_error" };
  }
}
