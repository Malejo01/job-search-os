import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de firma de webhooks Svix (los que usa Resend), sin dependencia:
 * contenido firmado = `${svix-id}.${svix-timestamp}.${body crudo}`, HMAC-SHA256 con el secreto
 * (`whsec_` + base64), firma en base64; el header `svix-signature` trae una o más `v1,<firma>`
 * separadas por espacio. Tolerancia de 5 minutos en el timestamp para frenar replays.
 */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  "svix-id": string | null;
  "svix-timestamp": string | null;
  "svix-signature": string | null;
};

export type SvixResult = { ok: true } | { ok: false; reason: string };

export const SVIX_INVALID_SECRET_REASON = "secreto inválido";

const SECRET_PREFIX = "whsec_";
const MIN_SECRET_BYTES = 16;

/** Secreto con el prefijo y una clave en base64 de al menos 16 bytes. Los espacios en los bordes no cuentan. */
function isValidSecret(secret: string): boolean {
  const value = secret.trim();
  if (!value.startsWith(SECRET_PREFIX)) return false;
  const key = value.slice(SECRET_PREFIX.length);
  return (
    /^[A-Za-z0-9+/]+={0,2}$/.test(key) && Buffer.from(key, "base64").length >= MIN_SECRET_BYTES
  );
}

export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  // El mismo valor recortado que valida `isValidSecret`: si no, un espacio adelante rompe todas las firmas
  const value = secret.trim();
  const key = Buffer.from(
    value.startsWith(SECRET_PREFIX) ? value.slice(SECRET_PREFIX.length) : value,
    "base64",
  );
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvix(
  headers: SvixHeaders,
  body: string,
  secret: string | undefined,
  now: () => number = Date.now,
): SvixResult {
  if (!secret) return { ok: false, reason: "RESEND_WEBHOOK_SECRET no configurado" };
  if (!isValidSecret(secret)) return { ok: false, reason: SVIX_INVALID_SECRET_REASON };
  const id = headers["svix-id"];
  const ts = headers["svix-timestamp"];
  const sig = headers["svix-signature"];
  if (!id || !ts || !sig) return { ok: false, reason: "faltan headers svix" };
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "svix-timestamp inválido" };
  if (Math.abs(now() / 1000 - tsNum) > SVIX_TOLERANCE_SECONDS) {
    return { ok: false, reason: "svix-timestamp fuera de la tolerancia de 5 min" };
  }
  const expected = Buffer.from(signSvix(secret, id, ts, body));
  for (const part of sig.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "firma no coincide" };
}
