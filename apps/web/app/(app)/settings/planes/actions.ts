"use server";

import { createLogger } from "@job-search-os/adapters";
import { isPlanSource } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NotInvitationAdminError } from "@/lib/invitations";
import { grantBetaPlan, PlanAdminNotEnabledInDbError, revokePlan } from "@/lib/plan-admin";
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
    const result = await grantBetaPlan(userId, { email, source });
    target = result.ok ? `${BACK}?ok=${source}` : `${BACK}?error=${result.reason}`;
    if (result.ok) {
      // Solo ids y el resultado: el email no se loguea
      createLogger({ user_id: userId, task: "admin_plan_grant" }).info(
        { source, until: result.until.toISOString() },
        "plan de la beta activado",
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
    target = (await revokePlan(userId, email)) ? `${BACK}?ok=quitado` : `${BACK}?error=no_existe`;
    if (target.includes("ok=")) {
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
