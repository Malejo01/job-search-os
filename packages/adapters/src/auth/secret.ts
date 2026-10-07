import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara el header `Authorization: Bearer <secreto>` contra el secreto esperado en tiempo
 * constante (SEC-07). Falla cerrado: sin secreto configurado, o sin header, siempre es false.
 * Se hashea a SHA-256 para que `timingSafeEqual` reciba buffers del mismo largo sin filtrar el
 * largo del secreto.
 */
export function checkBearerSecret(opts: {
  authorization: string | null | undefined;
  expected: string | null | undefined;
}): boolean {
  const { authorization, expected } = opts;
  if (!expected || !authorization) return false;
  const provided = `Bearer ${expected}`;
  const a = createHash("sha256").update(authorization).digest();
  const b = createHash("sha256").update(provided).digest();
  return timingSafeEqual(a, b) && authorization.length === provided.length;
}
