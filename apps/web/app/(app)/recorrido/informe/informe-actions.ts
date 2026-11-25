"use server";

import { createLogger, safeDbError, sendEmail } from "@job-search-os/adapters";
import { PRODUCT_NAME, REPORT_ITEMS_MAX } from "@job-search-os/pipeline";
import { after } from "next/server";
import {
  addItem,
  deleteItem,
  saveItems,
  sendReport,
  type ItemView,
  type SendReportResult,
} from "@/lib/feedback-report";
import {
  adminEmailsFrom,
  notifyReportAdmins,
  siteBaseUrl,
  type ReportEmailSender,
} from "@/lib/feedback-report-email";
import { canViewRecorrido } from "@/lib/recorrido-access";
import { activeSessionUserId } from "@/lib/session";

/**
 * Acciones del informe de revisión (R29-03). Toda acción: sesión vigente (sin redirigir: devuelve `session` y la
 * pantalla conserva el texto) y tester o admin (`canViewRecorrido`; el resto recibe `forbidden`, como si no
 * existiera). Devuelven códigos, nunca el texto de la persona ni el mensaje de una excepción; los logs llevan
 * `user_id` y cantidades, nunca el contenido.
 */

type Denied = { ok: false; reason: "session" | "forbidden" | "error" };

async function gate(): Promise<{ ok: true; userId: string } | Denied> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, reason: "session" };
  if (!(await canViewRecorrido(userId))) return { ok: false, reason: "forbidden" };
  return { ok: true, userId };
}

const logOf = (userId: string) => createLogger({ user_id: userId, task: "feedback_report" });

export type AddItemActionResult =
  | { ok: true; item: ItemView }
  | { ok: false; reason: "session" | "forbidden" | "error" | "invalid" | "too_many" };

/**
 * Suma un ítem al borrador. Vacío («Agregar ítem») o con pantalla, categoría y texto (el botón «Agregar al
 * informe» del modal «¿Algo no anduvo?»).
 */
export async function addItemAction(input?: {
  path?: string;
  category?: string;
  message?: string;
}): Promise<AddItemActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const out = await addItem(g.userId, {
      path: input?.path,
      category: input?.category,
      message: input?.message,
    });
    if (!out.ok) return out;
    logOf(g.userId).info({ position: out.item.position }, "informe: ítem agregado");
    return out;
  } catch (err) {
    logOf(g.userId).error({ err: safeDbError(err) }, "informe: falló agregar ítem");
    return { ok: false, reason: "error" };
  }
}

export type SaveItemsActionResult =
  | { ok: true; savedAt: string }
  | {
      ok: false;
      reason: "session" | "forbidden" | "error" | "invalid" | "locked";
      itemId?: string;
    };

/** Guarda lo que cambió: `[{ id, path, category, message }]`. Todo o nada. */
export async function saveItemsAction(items: unknown): Promise<SaveItemsActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!Array.isArray(items) || items.length > REPORT_ITEMS_MAX) {
    return { ok: false, reason: "invalid" };
  }
  const rows = items.map((raw: unknown) => {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return { id: r.id, path: r.path, category: r.category, message: r.message };
  });
  try {
    const out = await saveItems(g.userId, rows);
    if (!out.ok) return out;
    return { ok: true, savedAt: new Date().toISOString() };
  } catch (err) {
    logOf(g.userId).error({ err: safeDbError(err) }, "informe: falló el guardado");
    return { ok: false, reason: "error" };
  }
}

export type DeleteItemActionResult =
  { ok: true } | { ok: false; reason: "session" | "forbidden" | "error" | "locked" };

/** Quita un ítem del borrador con sus archivos. */
export async function deleteItemAction(itemId: unknown): Promise<DeleteItemActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (typeof itemId !== "string") return { ok: false, reason: "locked" };
  try {
    const done = await deleteItem(g.userId, itemId);
    return done ? { ok: true } : { ok: false, reason: "locked" };
  } catch (err) {
    logOf(g.userId).error({ err: safeDbError(err) }, "informe: falló quitar ítem");
    return { ok: false, reason: "error" };
  }
}

export type SendReportActionResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason: "session" | "forbidden" | "error" | "no_draft" | "empty" | "too_many" | "item_empty";
      position?: number;
    };

/**
 * El envío simulado de local y de los e2e (sin `RESEND_API_KEY`): no sale nada, solo queda el registro. Con la
 * clave, el envío real de Resend.
 */
function senderFor(
  env: NodeJS.ProcessEnv,
  log: ReturnType<typeof createLogger>,
): ReportEmailSender {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return async (m) => {
      log.info({ to_count: 1, subject: m.subject }, "informe: aviso simulado (sin RESEND_API_KEY)");
    };
  }
  const from =
    env.EMAIL_FROM ||
    (env.INGEST_DOMAIN ? `${PRODUCT_NAME} <soporte@${env.INGEST_DOMAIN}>` : undefined);
  return async (m) => {
    await sendEmail({ to: m.to, subject: m.subject, html: m.html, text: m.text, from }, apiKey);
  };
}

/**
 * Envía el informe: lo valida, lo marca `enviado` (desde ahí no se edita) y avisa a los admins por email con el
 * resumen y el link, sin nombre ni email de la persona.
 */
export async function sendReportAction(): Promise<SendReportActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  const log = logOf(g.userId);
  let out: SendReportResult;
  try {
    out = await sendReport(g.userId);
  } catch (err) {
    log.error({ err: safeDbError(err) }, "informe: falló el envío");
    return { ok: false, reason: "error" };
  }
  if (!out.ok) return out;
  log.info({ report_id: out.reportId }, "informe: enviado");
  after(async () => {
    try {
      const result = await notifyReportAdmins({
        summary: out.summary,
        baseUrl: siteBaseUrl(process.env),
        admins: adminEmailsFrom(process.env),
        send: senderFor(process.env, log),
      });
      if (result.failed > 0) log.warn(result, "informe: falló el aviso a algún admin");
    } catch (err) {
      log.error({ err: safeDbError(err) }, "informe: falló el aviso a los admins");
    }
  });
  return { ok: true, summary: out.summary };
}
