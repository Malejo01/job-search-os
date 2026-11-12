import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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

// ---------------------------------------------------------------------------------------------
// MCP-1: tokens personales por usuario. Cada persona de prueba conecta su chat con un token propio
// que opera SOLO sobre su cuenta. El valor en claro se muestra una vez y nunca se guarda: la base
// tiene el sha256 (mismo criterio que password-reset-token). Todo lo de acá es puro y sin I/O.
// ---------------------------------------------------------------------------------------------

export const MCP_USER_TOKEN_PREFIX = "afj_";
/** Vigencia de un token personal: 30 días desde que se crea. */
export const MCP_USER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Tokens activos (no revocados ni vencidos) por persona. */
export const MCP_USER_TOKEN_MAX_ACTIVE = 3;
/** Largo máximo del nombre que la persona le pone al token. */
export const MCP_TOKEN_LABEL_MAX = 60;
/** Tope por token y por minuto. Lo aplica la base (rls/0019_mcp_tokens.sql); acá queda documentado. */
export const MCP_USER_TOKEN_RATE_PER_MINUTE = 60;

/** "afj_" + 32 bytes aleatorios en base64url: 43 caracteres sin relleno. */
const USER_TOKEN_RE = /^afj_[A-Za-z0-9_-]{43}$/;

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateMcpUserToken(now: Date = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = MCP_USER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashMcpToken(token),
    expiresAt: new Date(now.getTime() + MCP_USER_TOKEN_TTL_MS),
  };
}

/** ¿Tiene el formato exacto de un token personal? No dice si existe ni si vale. */
export function isMcpUserToken(token: string): boolean {
  return USER_TOKEN_RE.test(token);
}

/**
 * El token del request: `Authorization: Bearer` o, solo con `allowQuery`, `?token=`. Si vino Bearer,
 * el query no se mira (mismo criterio que checkMcpToken). Sin token: null.
 */
export function extractMcpToken(input: {
  authorization: string | null;
  url: string;
  allowQuery: boolean;
}): string | null {
  const header = input.authorization ?? "";
  if (/^bearer /i.test(header)) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  if (!input.allowQuery) return null;
  try {
    const query = new URL(input.url).searchParams.get("token") ?? "";
    return query === "" ? null : query;
  } catch {
    return null;
  }
}

/** Tokens personales encendidos solo con `MCP_USER_TOKENS=testers`. Cualquier otro valor: apagados. */
export function mcpUserTokensEnabled(env: Record<string, string | undefined>): boolean {
  return env.MCP_USER_TOKENS?.trim() === "testers";
}

export type McpCredential =
  { kind: "shared" } | { kind: "user"; tokenHash: string } | { kind: "none" };

/**
 * Qué credencial trae el request. Primero MCP_TOKEN, con la misma función de siempre: el conector
 * existente no cambia en ningún caso. Después, un token personal, solo con el modo encendido y con el
 * formato exacto; sale el hash, nunca el valor en claro. Cualquier otra cosa: none (401).
 */
export function classifyMcpCredential(input: {
  authorization: string | null;
  url: string;
  allowQuery: boolean;
  sharedToken: string | undefined;
  userTokens: boolean;
}): McpCredential {
  const { authorization, url, allowQuery } = input;
  if (checkMcpToken({ authorization, url, expected: input.sharedToken, allowQuery })) {
    return { kind: "shared" };
  }
  if (!input.userTokens) return { kind: "none" };
  const token = extractMcpToken({ authorization, url, allowQuery });
  if (!token || !isMcpUserToken(token)) return { kind: "none" };
  return { kind: "user", tokenHash: hashMcpToken(token) };
}

/** Nombre del token: sin caracteres de control, espacios colapsados y hasta 60. Vacío: null. */
export function normalizeMcpTokenLabel(label: string | null | undefined): string | null {
  if (typeof label !== "string") return null;
  const clean = label
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean === "") return null;
  return clean.slice(0, MCP_TOKEN_LABEL_MAX).trim();
}

/** URL lista para pegar en el conector: `<origen>/api/mcp?token=<token>`. */
export function mcpConnectorUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/mcp?token=${encodeURIComponent(token)}`;
}
