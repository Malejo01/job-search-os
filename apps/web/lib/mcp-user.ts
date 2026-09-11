import { schema as s } from "@job-search-os/db";
import { timingSafeEqual } from "node:crypto";
import { getAppDb } from "./db";

/**
 * Autenticación del servidor MCP (JS-035): token compartido en `Authorization: Bearer` o en
 * `?token=` (para clientes que solo aceptan una URL, como el conector de claude.ai). No es OAuth
 * a propósito: un solo usuario, un solo token, rotable cambiando MCP_TOKEN.
 */
export function mcpTokenOk(req: Request): boolean {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const query = new URL(req.url).searchParams.get("token") ?? "";
  const given = bearer || query;
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
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
