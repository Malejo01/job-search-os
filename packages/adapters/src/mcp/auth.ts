import { createHash, timingSafeEqual } from "node:crypto";

export type McpAuthInput = {
  /** Valor del header `Authorization` (o null si no vino). */
  authorization: string | null;
  /** URL completa del request, solo para leer `?token=`. */
  url: string;
  /** Token esperado (MCP_TOKEN). Vacío o ausente: falla cerrado. */
  expected: string | undefined;
  /** MCP_ALLOW_QUERY_TOKEN === "1". */
  allowQuery: boolean;
};

/**
 * Comparación en tiempo constante. Se hashea a SHA-256 para que `timingSafeEqual` reciba buffers
 * del mismo largo y el tiempo no revele el largo del token (mismo criterio que auth/secret.ts).
 */
function safeEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Autenticación del MCP (SEC-02). Solo `Authorization: Bearer <token>`.
 * `?token=` se acepta únicamente con `allowQuery` (MCP_ALLOW_QUERY_TOKEN=1): el conector de
 * claude.ai puede necesitar una URL, pero un token en la URL queda en logs y en el historial.
 * Sin token esperado, falla cerrado.
 */
export function checkMcpToken(input: McpAuthInput): boolean {
  const { authorization, url, expected, allowQuery } = input;
  if (!expected) return false;

  const header = authorization ?? "";
  const bearer = /^bearer /i.test(header) ? header.slice(7).trim() : "";
  if (bearer) return safeEqual(bearer, expected);

  if (!allowQuery) return false;
  try {
    const query = new URL(url).searchParams.get("token") ?? "";
    return query !== "" && safeEqual(query, expected);
  } catch {
    return false;
  }
}
