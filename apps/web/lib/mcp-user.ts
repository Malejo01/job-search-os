import { checkMcpToken } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
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
  const rows = await getAppDb().select({ id: s.users.id }).from(s.users).limit(2);
  if (rows.length !== 1) {
    throw new Error(
      `MCP_USER_ID no definido y la tabla users tiene ${rows.length} filas: definilo explícitamente`,
    );
  }
  cachedUserId = rows[0]!.id;
  return cachedUserId;
}
