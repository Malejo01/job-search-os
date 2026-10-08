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

/** users.id que opera el MCP: MCP_USER_ID o, si hay un solo usuario, ese. */
export async function resolveMcpUserId(): Promise<string> {
  if (process.env.MCP_USER_ID) return process.env.MCP_USER_ID;
  if (cachedUserId) return cachedUserId;
  // sole_user_id (SECURITY DEFINER): el id si hay exactamente un usuario, si no NULL.
  const [row] = (await getAppDb().execute(sql`select sole_user_id() as id`)) as unknown as {
    id: string | null;
  }[];
  if (!row?.id) {
    throw new Error(
      "MCP_USER_ID no definido y no hay exactamente un usuario: definí MCP_USER_ID explícitamente",
    );
  }
  cachedUserId = row.id;
  return cachedUserId;
}
