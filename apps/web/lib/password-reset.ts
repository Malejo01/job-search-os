import {
  consumeResetToken,
  createLogger,
  markAllResetTokensUsed,
  resetUrlBase,
  sendEmail,
} from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { hashPassword } from "@job-search-os/db/password";
import { generateResetToken, hashResetToken } from "@job-search-os/db/password-reset-token";
import { PRODUCT_NAME } from "@job-search-os/pipeline";
import { and, eq, gt, sql } from "drizzle-orm";
import { after } from "next/server";
import { getAppDb, withUser } from "./db";
import { MAX_PASSWORD_LENGTH } from "./invitations-core";

/**
 * Pide el reset (JS-045). Nunca revela si el email existe: siempre termina en silencio para
 * el caller. Dentro del request solo corre el lookup (igual exista o no); crear el token y mandar
 * el email van en `after()`, así el tiempo de respuesta no distingue los dos casos.
 * Sin RESEND_API_KEY el token igual se crea (útil para dev/e2e) pero no se manda
 * nada, como hace inbound/resend.ts cuando falta la key.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  // user_id_by_email (SECURITY DEFINER): el rol de la app no lee users ajenos. Solo devuelve el id.
  const [found] = (await getAppDb().execute(
    sql`select user_id_by_email(${normalized}) as id`,
  )) as unknown as { id: string | null }[];
  if (!found?.id) return;
  const user = { id: found.id, email: normalized };
  after(async () => {
    try {
      await issueResetToken(user);
    } catch (error) {
      // Sin el email en el log: solo el user_id
      createLogger({ user_id: user.id, task: "password_reset_email" }).error(
        { error },
        "no se pudo crear el token de recuperación",
      );
    }
  });
}

/** S-4 (C-5 seguridad P0-1): un reset cada 5 minutos por cuenta, como respaldo del firewall. */
export const RESET_COOLDOWN_MS = 5 * 60_000;

async function issueResetToken(user: { id: string; email: string }): Promise<void> {
  const { token, tokenHash, expiresAt } = generateResetToken();
  const issued = await withUser(user.id, async (tx) => {
    const [recent] = await tx
      .select({ id: s.passwordResetTokens.id })
      .from(s.passwordResetTokens)
      .where(
        and(
          eq(s.passwordResetTokens.userId, user.id),
          gt(s.passwordResetTokens.createdAt, new Date(Date.now() - RESET_COOLDOWN_MS)),
        ),
      )
      .limit(1);
    if (recent) return false;
    await tx.insert(s.passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt });
    return true;
  });
  // Mismo silencio hacia quien pide: el link anterior sigue sirviendo
  if (!issued) {
    createLogger({ user_id: user.id, task: "password_reset_email" }).info(
      "reset pedido de nuevo antes de 5 minutos: no se manda otro email",
    );
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  // URL base solo de la configuración, nunca de Host/x-forwarded-* (SEC-05).
  const base = resetUrlBase();
  if (!base.ok) {
    createLogger({ user_id: user.id, task: "password_reset_email" }).error(
      { reason: base.error },
      "no se manda el email de recuperación: sin URL base",
    );
    return;
  }
  const link = `${base.url}/reset-password?token=${token}`;
  try {
    await sendEmail(
      {
        to: user.email,
        subject: `Recuperar contraseña — ${PRODUCT_NAME}`,
        html: `<p>Pediste restablecer tu contraseña.</p><p><a href="${link}">Elegí una nueva contraseña</a></p><p>El link vence en una hora. Si no fuiste vos, ignorá este email.</p>`,
        from: process.env.EMAIL_FROM,
      },
      apiKey,
    );
  } catch (error) {
    // Nunca revienta el flujo (mismo criterio de no revelar nada al que pide el reset):
    // el token ya quedó creado y sirve igual si el link llega por otro medio.
    createLogger({ user_id: user.id, task: "password_reset_email" }).error(
      { error },
      "no se pudo mandar el email de recuperación",
    );
  }
}

export type ResetTokenCheck =
  { ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" | "used" };

export async function checkResetToken(token: string): Promise<ResetTokenCheck> {
  if (!token) return { ok: false, reason: "invalid" };
  const tokenHash = hashResetToken(token);
  // check_reset_token (SECURITY DEFINER): el rol de la app no lista tokens ajenos (llega sin sesión).
  // La función devuelve timestamptz; el driver puede entregarlos como Date o como string.
  const [row] = (await getAppDb().execute(
    sql`select user_id, expires_at, used_at from check_reset_token(${tokenHash})`,
  )) as unknown as { user_id: string; expires_at: Date | string; used_at: Date | string | null }[];
  if (!row) return { ok: false, reason: "invalid" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.user_id };
}

/**
 * Consume el token y cambia la contraseña; `hashPassword` tira si tiene menos de 8 caracteres.
 * S-3: el token se consume con un UPDATE condicional dentro de la misma transacción que cambia la
 * contraseña. Si otro pedido con el mismo link ganó la carrera, no se cambia nada y vuelve "used".
 */
export async function resetPassword(token: string, newPassword: string): Promise<ResetTokenCheck> {
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`la contraseña no puede pasar de ${MAX_PASSWORD_LENGTH} caracteres`);
  }
  const check = await checkResetToken(token);
  if (!check.ok) return check;
  const passwordHash = hashPassword(newPassword);
  const now = new Date();
  const changed = await withUser(check.userId, async (tx) => {
    if ((await consumeResetToken(tx, hashResetToken(token), now)) !== check.userId) return false;
    // S-6: sube la versión de sesión, así las sesiones abiertas antes del reset dejan de valer
    const sessionVersion = sql`${s.users.sessionVersion} + 1`;
    await tx
      .update(s.users)
      .set({ passwordHash, sessionVersion, updatedAt: now })
      .where(eq(s.users.id, check.userId));
    // Todos los tokens del usuario, no solo el consumido: un link viejo no sobrevive al reset.
    await markAllResetTokensUsed(tx, check.userId, now);
    return true;
  });
  return changed ? check : { ok: false, reason: "used" };
}
