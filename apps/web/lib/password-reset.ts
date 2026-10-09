import {
  createLogger,
  markAllResetTokensUsed,
  resetUrlBase,
  sendEmail,
} from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { hashPassword } from "@job-search-os/db/password";
import { generateResetToken, hashResetToken } from "@job-search-os/db/password-reset-token";
import { PRODUCT_NAME } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { getAppDb, withUser } from "./db";

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

async function issueResetToken(user: { id: string; email: string }): Promise<void> {
  const { token, tokenHash, expiresAt } = generateResetToken();
  await withUser(user.id, (tx) =>
    tx.insert(s.passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt }),
  );
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

/** Consume el token y cambia la contraseña; `hashPassword` tira si tiene menos de 8 caracteres. */
export async function resetPassword(token: string, newPassword: string): Promise<ResetTokenCheck> {
  const check = await checkResetToken(token);
  if (!check.ok) return check;
  const passwordHash = hashPassword(newPassword);
  await withUser(check.userId, async (tx) => {
    await tx
      .update(s.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(s.users.id, check.userId));
    // Todos los tokens del usuario, no solo el consumido: un link viejo no sobrevive al reset.
    await markAllResetTokensUsed(tx, check.userId, new Date());
  });
  return check;
}
