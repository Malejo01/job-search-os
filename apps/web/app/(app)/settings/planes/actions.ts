"use server";

import { createLogger, sendWelcomeEmail } from "@job-search-os/adapters";
import { isPlanOverride, isPlanSource, parseRejectReason } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireAdminOrThrow } from "@/lib/admin-guard";
import { NotInvitationAdminError } from "@/lib/invitations";
import {
  activatePaymentNotice,
  grantBetaPlan,
  PlanAdminNotEnabledInDbError,
  recordPlanEvent,
  rejectPaymentNotice,
  revokePlan,
  setPlanOverride,
} from "@/lib/plan-admin";
import { requireActiveUserId } from "@/lib/session";

const BACK = "/settings/planes";

/** Traduce los errores de administración a un código corto de la URL (nunca el email de la persona). */
function errorCode(error: unknown): string {
  if (error instanceof NotInvitationAdminError) return "no_admin";
  if (error instanceof PlanAdminNotEnabledInDbError) return "sin_base";
  throw error;
}

/** Activa o renueva 30 días del plan de la beta, como pago o como beca (primer mes gratis). */
export async function grantPlanAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const email = String(formData.get("email") ?? "");
  const source = formData.get("source");
  if (!isPlanSource(source)) redirect(`${BACK}?error=origen`);
  let target: string;
  try {
    await requireAdminOrThrow(userId);
    const result = await grantBetaPlan(userId, { email, source });
    target = result.ok ? `${BACK}?ok=${source}` : `${BACK}?error=${result.reason}`;
    if (result.ok) {
      // Solo ids y el resultado: el email no se loguea
      createLogger({ user_id: userId, task: "admin_plan_grant" }).info(
        { source, until: result.until.toISOString() },
        "plan de la beta activado",
      );
      await recordPlanEvent(
        userId,
        result.email,
        result.activated ? "activar" : "renovar",
        result.source,
      );
      // Bienvenida (C8-7): solo en una activación, después de responder (no frena el panel).
      // Apagada salvo WELCOME_EMAIL_ENABLED=1
      if (result.activated) {
        const { email: to, until, source: planSource } = result;
        after(async () => {
          await sendWelcomeEmail({
            to,
            until,
            source: planSource,
            env: process.env,
            logger: createLogger({ user_id: userId, task: "welcome_email" }),
          });
        });
      }
    }
  } catch (error) {
    target = `${BACK}?error=${errorCode(error)}`;
  }
  revalidatePath(BACK);
  redirect(target);
}

/** Un id de aviso válido (uuid) o null: nunca llega a la base otra cosa. */
function noticeId(formData: FormData): string | null {
  const raw = formData.get("noticeId");
  return typeof raw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null;
}

/**
 * «Activar 30 días» sobre un aviso «Ya pagué» (R22-02): da el plan como pago y marca el aviso activado, todo
 * en una transacción de la base. Si el aviso ya estaba resuelto no cambia nada.
 */
export async function activateNoticeAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const id = noticeId(formData);
  if (!id) redirect(`${BACK}?error=aviso`);
  let target: string;
  try {
    await requireAdminOrThrow(userId);
    const result = await activatePaymentNotice(userId, id);
    target = result.ok ? `${BACK}?ok=aviso_activado` : `${BACK}?error=aviso_${result.reason}`;
    if (result.ok) {
      createLogger({ user_id: userId, task: "admin_notice_activate" }).info(
        { notice_id: id, until: result.until.toISOString() },
        "aviso de pago activado",
      );
      if (result.activated) {
        const { email: to, until } = result;
        after(async () => {
          await sendWelcomeEmail({
            to,
            until,
            source: "pago",
            env: process.env,
            logger: createLogger({ user_id: userId, task: "welcome_email" }),
          });
        });
      }
    }
  } catch (error) {
    target = `${BACK}?error=${errorCode(error)}`;
  }
  revalidatePath(BACK);
  redirect(target);
}

/** «Rechazar» un aviso «Ya pagué» con un motivo corto (1 a 200 caracteres). */
export async function rejectNoticeAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const id = noticeId(formData);
  if (!id) redirect(`${BACK}?error=aviso`);
  const reason = parseRejectReason(formData.get("reason"));
  if (!reason.ok) redirect(`${BACK}?error=aviso_motivo_invalido`);
  let target: string;
  try {
    await requireAdminOrThrow(userId);
    const result = await rejectPaymentNotice(userId, id, reason.value);
    target = result.ok ? `${BACK}?ok=aviso_rechazado` : `${BACK}?error=aviso_${result.reason}`;
    if (result.ok) {
      createLogger({ user_id: userId, task: "admin_notice_reject" }).info(
        { notice_id: id },
        "aviso de pago rechazado",
      );
    }
  } catch (error) {
    target = `${BACK}?error=${errorCode(error)}`;
  }
  revalidatePath(BACK);
  redirect(target);
}

/**
 * Pone o saca la marca de precio especial (ADR-040): `becado`, `tester_50` o `ninguna` para sacarla. Solo
 * admin (la app y la base); la persona no puede escribir su propia marca.
 */
export async function setPlanOverrideAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const email = String(formData.get("email") ?? "");
  const raw = formData.get("override");
  const override = raw === "ninguna" ? null : isPlanOverride(raw) ? raw : undefined;
  if (override === undefined) redirect(`${BACK}?error=marca`);
  let target: string;
  try {
    await requireAdminOrThrow(userId);
    const done = await setPlanOverride(userId, { email, override });
    target = done
      ? `${BACK}?ok=${override === null ? "marca_quitada" : "marca_puesta"}`
      : `${BACK}?error=marca_no_existe`;
    if (done) {
      await recordPlanEvent(userId, email, "marca");
      // Solo el id del admin y la marca: el email de la persona no se loguea
      createLogger({ user_id: userId, task: "admin_plan_override" }).info(
        { override },
        "marca de precio especial cambiada",
      );
    }
  } catch (error) {
    target = `${BACK}?error=${errorCode(error)}`;
  }
  revalidatePath(BACK);
  redirect(target);
}

/** Pasa a la persona al plan gratis. No borra nada de lo suyo. */
export async function revokePlanAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const email = String(formData.get("email") ?? "");
  let target: string;
  try {
    await requireAdminOrThrow(userId);
    target = (await revokePlan(userId, email)) ? `${BACK}?ok=quitado` : `${BACK}?error=no_existe`;
    if (target.includes("ok=")) {
      await recordPlanEvent(userId, email, "quitar");
      createLogger({ user_id: userId, task: "admin_plan_revoke" }).info(
        {},
        "plan de la beta quitado",
      );
    }
  } catch (error) {
    target = `${BACK}?error=${errorCode(error)}`;
  }
  revalidatePath(BACK);
  redirect(target);
}
