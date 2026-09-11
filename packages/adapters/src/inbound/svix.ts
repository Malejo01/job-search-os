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

export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvix(
  headers: SvixHeaders,
  body: string,
  secret: string | undefined,
  now: () => number = Date.now,
): SvixResult {
  if (!secret) return { ok: false, reason: "RESEND_WEBHOOK_SECRET no configurado" };
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
