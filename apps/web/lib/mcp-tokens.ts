import {
  generateMcpUserToken,
  MCP_USER_TOKEN_MAX_ACTIVE,
  mcpUserTokensEnabled,
} from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { canUseAssistant } from "./assistant";
import { withUser } from "./db";
import { isUuid } from "./ids";

/**
 * Tokens personales del MCP (MCP-1): lista, alta y revocación desde /settings/conexiones. Todo pasa
 * por withUser, así que las policies de mcp_tokens (rls/0019) acotan cada sentencia a la persona.
 * El valor en claro solo existe en la respuesta de `createMcpToken`; la base guarda el sha256.
 */

/** ¿Esta persona puede crear y usar tokens? Modo encendido y el mismo gate que el asistente. */
export async function canUseMcpTokens(userId: string): Promise<boolean> {
  if (!mcpUserTokensEnabled(process.env)) return false;
  return canUseAssistant(userId);
}

export type McpTokenStatus = "activo" | "vencido" | "revocado";

export type McpTokenView = {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  status: McpTokenStatus;
};

export function mcpTokenStatus(
  row: { revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): McpTokenStatus {
  if (row.revokedAt) return "revocado";
  return row.expiresAt.getTime() > now.getTime() ? "activo" : "vencido";
}

export async function listMcpTokens(userId: string): Promise<McpTokenView[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: s.mcpTokens.id,
        label: s.mcpTokens.label,
        createdAt: s.mcpTokens.createdAt,
        lastUsedAt: s.mcpTokens.lastUsedAt,
        expiresAt: s.mcpTokens.expiresAt,
        revokedAt: s.mcpTokens.revokedAt,
      })
      .from(s.mcpTokens)
      .where(eq(s.mcpTokens.userId, userId))
      .orderBy(desc(s.mcpTokens.createdAt))
      .limit(50),
  );
  const now = new Date();
  return rows.map(({ revokedAt, ...r }) => ({
    ...r,
    status: mcpTokenStatus({ revokedAt, expiresAt: r.expiresAt }, now),
  }));
}

export type CreateMcpTokenResult =
  { ok: true; token: string; expiresAt: Date } | { ok: false; reason: "limite" };

/**
 * Crea un token con nombre ya normalizado. Máximo 3 activos: el conteo y el alta van en la misma
 * transacción con un lock por persona, así dos altas simultáneas no pasan el tope.
 */
export async function createMcpToken(userId: string, label: string): Promise<CreateMcpTokenResult> {
  const { token, tokenHash, expiresAt } = generateMcpUserToken();
  return withUser(userId, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"mcp_tokens:" + userId}, 0))`,
    );
    const [active] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.mcpTokens)
      .where(
        and(
          eq(s.mcpTokens.userId, userId),
          isNull(s.mcpTokens.revokedAt),
          gt(s.mcpTokens.expiresAt, sql`now()`),
        ),
      );
    if ((active?.n ?? 0) >= MCP_USER_TOKEN_MAX_ACTIVE) return { ok: false, reason: "limite" };
    await tx.insert(s.mcpTokens).values({ userId, tokenHash, label, expiresAt });
    return { ok: true, token, expiresAt };
  });
}

/** Revoca un token propio. Devuelve si cambió algo (uno ajeno o ya revocado: false). */
export async function revokeMcpToken(userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await withUser(userId, (tx) =>
    tx
      .update(s.mcpTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(s.mcpTokens.id, id), eq(s.mcpTokens.userId, userId), isNull(s.mcpTokens.revokedAt)),
      )
      .returning({ id: s.mcpTokens.id }),
  );
  return rows.length === 1;
}
