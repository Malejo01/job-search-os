import { classifyMcpCredential, mcpUserTokensEnabled } from "@job-search-os/adapters";
import { sql } from "drizzle-orm";
import { canUseAssistant } from "./assistant";
import { getAppDb } from "./db";
import { isUuid } from "./ids";

/**
 * Autenticación del servidor MCP (JS-035, SEC-02, MCP-1). Dos credenciales, en este orden:
 *
 * 1. `MCP_TOKEN` (compartido, el conector de siempre): opera sobre `MCP_USER_ID` o, si falta, sobre el
 *    único usuario. Sin cambios de comportamiento: el usuario se resuelve en cada llamada a una tool.
 * 2. Token personal `afj_…` (MCP-1), solo con `MCP_USER_TOKENS=testers`: se resuelve por su sha256 con
 *    mcp_token_user() (rls/0019), que además lleva el tope de 60 llamadas por minuto. El dueño tiene
 *    que estar en la lista de testers, con el mismo criterio que el asistente (canUseAssistant).
 *
 * En los dos casos `?token=` se acepta solo con MCP_ALLOW_QUERY_TOKEN=1. No hay usuario cacheado entre
 * requests: con varias personas, un valor global podría mezclar cuentas. El token nunca se loguea ni
 * vuelve en un error: las respuestas de falla son genéricas.
 */
export type McpPrincipal = { kind: "user"; userId: string } | { kind: "shared" };

export type McpAuthResult =
  { ok: true; principal: McpPrincipal } | { ok: false; status: 401 | 429 };

const UNAUTHORIZED: McpAuthResult = { ok: false, status: 401 };

export async function authenticateMcpRequest(req: Request): Promise<McpAuthResult> {
  const credential = classifyMcpCredential({
    authorization: req.headers.get("authorization"),
    url: req.url,
    allowQuery: process.env.MCP_ALLOW_QUERY_TOKEN === "1",
    sharedToken: process.env.MCP_TOKEN,
    userTokens: mcpUserTokensEnabled(process.env),
  });
  if (credential.kind === "none") return UNAUTHORIZED;
  if (credential.kind === "shared") return { ok: true, principal: { kind: "shared" } };

  let row: { user_id: string; rate_limited: boolean } | undefined;
  try {
    [row] = (await getAppDb().execute(
      sql`select user_id, rate_limited from mcp_token_user(${credential.tokenHash})`,
    )) as unknown as { user_id: string; rate_limited: boolean }[];
  } catch {
    // Falla cerrado y sin detalle: un error de la base no dice si el token existe
    return UNAUTHORIZED;
  }
  // Revocado, vencido o inexistente: la función no devuelve fila y la respuesta es la misma
  if (!row || !isUuid(row.user_id)) return UNAUTHORIZED;
  // Fuera de la lista de testers: como si el token no existiera (canUseAssistant falla cerrado)
  if (!(await canUseAssistant(row.user_id))) return UNAUTHORIZED;
  if (row.rate_limited) return { ok: false, status: 429 };
  return { ok: true, principal: { kind: "user", userId: row.user_id } };
}

/** user_exists (SECURITY DEFINER): la cuenta pudo borrarse después de configurar MCP_USER_ID. */
async function userExists(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [row] = (await getAppDb().execute(
    sql`select user_exists(${id}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  return row?.ok === true;
}

/**
 * users.id del conector compartido (MCP_TOKEN): MCP_USER_ID o, si hay un solo usuario, ese. Falla
 * cerrado si la cuenta ya no existe (borrada) o si hay 2 o más usuarios y falta MCP_USER_ID. Se
 * consulta en cada llamada (MCP-1: sin caché global).
 */
export async function resolveMcpUserId(): Promise<string> {
  const configured = process.env.MCP_USER_ID;
  if (configured) {
    if (!(await userExists(configured))) {
      throw new Error("MCP_USER_ID apunta a una cuenta que no existe: revisá MCP_USER_ID");
    }
    return configured;
  }
  // sole_user_id (SECURITY DEFINER): el id si hay exactamente un usuario, si no NULL.
  const [row] = (await getAppDb().execute(sql`select sole_user_id() as id`)) as unknown as {
    id: string | null;
  }[];
  if (!row?.id) {
    throw new Error(
      "MCP_USER_ID no definido y no hay exactamente un usuario: configurá MCP_USER_ID",
    );
  }
  return row.id;
}

/**
 * El usuario de ESTE request para una tool, a partir de lo que `guarded()` dejó en `authInfo.extra`
 * (llega por ctx.http.authInfo). Sin principal válido, tira: nunca se cae a otro usuario.
 */
export async function mcpUserIdFor(
  authInfo: { extra?: Record<string, unknown> } | undefined,
): Promise<string> {
  const principal = authInfo?.extra?.principal as McpPrincipal | undefined;
  if (principal?.kind === "user" && isUuid(principal.userId)) return principal.userId;
  if (principal?.kind === "shared") return resolveMcpUserId();
  throw new Error("no autorizado");
}
