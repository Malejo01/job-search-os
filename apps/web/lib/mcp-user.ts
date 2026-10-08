import { checkMcpToken } from "@job-search-os/adapters";
import { sql } from "drizzle-orm";
import { getAppDb } from "./db";

/**
 * Autenticación del servidor MCP (JS-035, SEC-02): token compartido en `Authorization: Bearer`.
 * `?token=` se acepta solo con MCP_ALLOW_QUERY_TOKEN=1, porque el conector de claude.ai puede
 * necesitar una URL; el token en la URL queda en logs, así que es opt-in. No es OAuth a
 * propósito: un solo usuario, un solo token, rotable cambiando MCP_TOKEN.
 */
export function mcpTokenOk(req: Request): boolean {
  return checkMcpToken({
    authorization: req.headers.get("authorization"),
    url: req.url,
    expected: process.env.MCP_TOKEN,
    allowQuery: process.env.MCP_ALLOW_QUERY_TOKEN === "1",
  });
}

let cachedUserId: string | null = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** user_exists (SECURITY DEFINER): la cuenta pudo borrarse después de configurar o cachear el id. */
async function userExists(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const [row] = (await getAppDb().execute(
    sql`select user_exists(${id}::uuid) as ok`,
  )) as unknown as { ok: boolean }[];
  return row?.ok === true;
}

/**
 * users.id que opera el MCP: MCP_USER_ID o, si hay un solo usuario, ese. Falla cerrado si la
 * cuenta ya no existe (borrada) o si hay 2 o más usuarios y falta MCP_USER_ID.
 */
export async function resolveMcpUserId(): Promise<string> {
  const configured = process.env.MCP_USER_ID;
  if (configured) {
    if (!(await userExists(configured))) {
      cachedUserId = null;
      throw new Error("MCP_USER_ID apunta a una cuenta que no existe: revisá MCP_USER_ID");
    }
    return configured;
  }
  if (cachedUserId) {
    if (await userExists(cachedUserId)) return cachedUserId;
    cachedUserId = null;
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
  cachedUserId = row.id;
  return cachedUserId;
}
