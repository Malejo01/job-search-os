"use server";

import { mcpConnectorUrl, normalizeMcpTokenLabel } from "@job-search-os/adapters";
import { revalidatePath } from "next/cache";
import { canUseMcpTokens, createMcpToken, revokeMcpToken } from "@/lib/mcp-tokens";
import { requireActiveUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";

export type CreateMcpTokenState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; url: string; label: string };

/**
 * Crea un token personal del MCP (MCP-1) y devuelve la URL lista para el conector. Es la única vez que
 * el token en claro sale del servidor: no se guarda, no se loguea y no va en la URL de la página.
 * Sesión y gate se verifican acá, no solo en la página (una server action se puede invocar directo).
 */
export async function createMcpTokenAction(
  _prev: CreateMcpTokenState,
  formData: FormData,
): Promise<CreateMcpTokenState> {
  const userId = await requireActiveUserId();
  if (!(await canUseMcpTokens(userId))) {
    return { status: "error", message: "Tu cuenta no puede crear conexiones." };
  }
  const label = normalizeMcpTokenLabel(String(formData.get("label") ?? ""));
  if (!label) return { status: "error", message: "Poné un nombre, por ejemplo «ChatGPT»." };
  const created = await createMcpToken(userId, label);
  if (!created.ok) {
    return {
      status: "error",
      message: "Ya tenés 3 conexiones activas. Revocá una para crear otra.",
    };
  }
  revalidatePath("/settings/conexiones");
  return { status: "created", url: mcpConnectorUrl(siteUrl(), created.token), label };
}

/** Revoca un token propio. Deja de funcionar al instante (el próximo request da 401). */
export async function revokeMcpTokenAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  // Sin gate de tester: revocar lo propio siempre tiene que poder hacerse
  await revokeMcpToken(userId, String(formData.get("id") ?? ""));
  revalidatePath("/settings/conexiones");
}
