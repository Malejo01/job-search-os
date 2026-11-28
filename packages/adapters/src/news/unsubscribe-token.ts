import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Enlace de baja del email de novedades (R32-09): firmado, con vencimiento, sin sesión y que falla cerrado. El token
 * es `{user_id}.{vence}.{firma}`: `vence` son segundos Unix y la firma es el HMAC-SHA256 (base64url) del id y el
 * vencimiento con un propósito fijo, así que sirve solo para esta baja. La comparación es en tiempo constante. Sin
 * una clave de al menos 16 caracteres no se firma ni se acepta nada. Quien verifica no distingue «firma mala» de
 * «vencido» ni de «cuenta inexistente»: todo es el mismo aviso.
 */

const PURPOSE = "news-email-unsubscribe:v2:";
const MIN_SECRET_LENGTH = 16;
/** El enlace vale 90 días: alcanza para un email que se abre tarde; después se baja desde Ajustes. */
export const NEWS_UNSUBSCRIBE_TTL_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La clave de las firmas: `NEWS_EMAIL_SECRET` y, si falta, `AUTH_SECRET`. `null` si no hay una usable. */
export function newsEmailSecret(env: Record<string, string | undefined>): string | null {
  const secret = env.NEWS_EMAIL_SECRET?.trim() || env.AUTH_SECRET?.trim() || "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function signature(userId: string, expires: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${PURPOSE}${userId.toLowerCase()}:${expires}`)
    .digest("base64url");
}

export function signNewsUnsubscribe(
  userId: string,
  secret: string,
  now: Date = new Date(),
): string {
  if (secret.length < MIN_SECRET_LENGTH)
    throw new Error("clave de firma ausente o demasiado corta");
  if (!UUID.test(userId)) throw new Error("el id de la persona no es un uuid");
  const expires = Math.floor(now.getTime() / 1000) + NEWS_UNSUBSCRIBE_TTL_DAYS * 86_400;
  return `${userId.toLowerCase()}.${expires}.${signature(userId, expires, secret)}`;
}

/** El id de la persona si el token es auténtico y no venció; `null` ante cualquier otra cosa. */
export function verifyNewsUnsubscribe(
  token: unknown,
  secret: string,
  now: Date = new Date(),
): string | null {
  if (typeof token !== "string" || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expRaw, sig] = parts as [string, string, string];
  if (!UUID.test(userId) || !/^\d{1,12}$/.test(expRaw) || sig.length === 0) return null;
  const expires = Number(expRaw);
  const expected = Buffer.from(signature(userId, expires, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (expires * 1000 < now.getTime()) return null;
  return userId.toLowerCase();
}

/** El enlace de baja que va en el email: `{origen}/novedades/baja?t={token}`. */
export function newsUnsubscribeUrl(
  appUrl: string,
  userId: string,
  secret: string,
  now: Date = new Date(),
): string {
  const token = signNewsUnsubscribe(userId, secret, now);
  return `${appUrl.replace(/\/+$/, "")}/novedades/baja?t=${token}`;
}
