import { createLogger, sendEmail } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { hashPassword } from "@job-search-os/db/password";
import { generateResetToken, hashResetToken } from "@job-search-os/db/password-reset-token";
import { eq } from "drizzle-orm";
import { getAppDb, withUser } from "./db";

/**
 * Pide el reset (JS-045). Nunca revela si el email existe: siempre termina en silencio para
 * el caller. Sin RESEND_API_KEY el token igual se crea (útil para dev/e2e) pero no se manda
 * nada, como hace inbound/resend.ts cuando falta la key.
 */
export async function requestPasswordReset(email: string, resetUrlBase: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const [user] = await getAppDb()
    .select({ id: s.users.id, email: s.users.email })
    .from(s.users)
    .where(eq(s.users.email, normalized))
    .limit(1);
  if (!user) return;
  const { token, tokenHash, expiresAt } = generateResetToken();
  await withUser(user.id, (tx) =>
    tx.insert(s.passwordResetTokens).values({ userId: user.id, tokenHash, expiresAt }),
  );
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const link = `${resetUrlBase}/reset-password?token=${token}`;
  try {
    await sendEmail(
      {
        to: user.email,
        subject: "Recuperar contraseña — Job Search OS",
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
  const [row] = await getAppDb()
    .select({
      userId: s.passwordResetTokens.userId,
      expiresAt: s.passwordResetTokens.expiresAt,
      usedAt: s.passwordResetTokens.usedAt,
    })
    .from(s.passwordResetTokens)
    .where(eq(s.passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}

/** Consume el token y cambia la contraseña; `hashPassword` tira si tiene menos de 8 caracteres. */
export async function resetPassword(token: string, newPassword: string): Promise<ResetTokenCheck> {
  const check = await checkResetToken(token);
  if (!check.ok) return check;
  const tokenHash = hashResetToken(token);
  const passwordHash = hashPassword(newPassword);
  await withUser(check.userId, async (tx) => {
    await tx
      .update(s.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(s.users.id, check.userId));
    await tx
      .update(s.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(s.passwordResetTokens.tokenHash, tokenHash));
  });
  return check;
}
