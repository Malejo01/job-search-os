import { createHash, randomBytes } from "node:crypto";

/**
 * Token de recuperación de contraseña (JS-045). El valor en claro va en el link del email y
 * nunca se persiste: solo se guarda su sha256 (`tokenHash`). Un token vale 1 hora y una sola vez.
 */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(now: Date = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
  };
}
