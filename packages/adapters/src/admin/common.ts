import {
  confirmRemoteTarget,
  describeDatabaseUrl,
  isRemoteDatabase,
  requireDatabaseUrl,
} from "@job-search-os/db";
import { createInterface } from "node:readline/promises";
import { z } from "zod";

/** Piezas compartidas por los comandos de operación (admin:invite, admin:test-users, inbound:replay). */

export type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string };

const emailSchema = z.email().max(254);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Email válido y normalizado, o null. */
export function parseEmail(value: string | undefined): string | null {
  if (value === undefined) return null;
  const email = normalizeEmail(value);
  return emailSchema.safeParse(email).success ? email : null;
}

/** `l***@dominio`: para logs y listados. Lo que no parece un email sale como `***`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Opciones de confirmación remota de estos comandos: `env: {}` hace que CONFIRM_PRODUCTION
 * (del entorno o de .env.local) NO saltee la pregunta. Contra la nube siempre hace falta una
 * persona en una terminal escribiendo "si".
 */
export function remoteConfirmOptions(
  action: string,
  log: (message: string) => void,
): { action: string; log: (message: string) => void; env: Record<string, string | undefined> } {
  return { action, log, env: {} };
}

/**
 * Destino de la base: local por defecto; la nube solo con `--remote`, y entonces pide confirmar
 * (en una terminal; sin terminal aborta, sin excepción por variables). Nunca imprime la URL: en
 * local, usuario@host/base; en remoto, solo "remoto".
 */
export async function resolveTargetUrl(
  remote: boolean,
  action: string,
  log: (message: string) => void = console.error,
): Promise<{ ok: true; url: string; label: string } | { ok: false; error: string }> {
  let url: string;
  try {
    url = requireDatabaseUrl({ purpose: "service", target: remote ? "cloud" : "local" });
  } catch {
    return { ok: false, error: "no hay base configurada para el destino elegido" };
  }
  if (!remote && isRemoteDatabase(url)) {
    return {
      ok: false,
      error: "el destino local apunta a una base que no es de esta máquina: usá --remote",
    };
  }
  if (remote) {
    const confirmed = await confirmRemoteTarget(url, remoteConfirmOptions(action, log));
    if (!confirmed)
      return { ok: false, error: "operación cancelada: destino remoto sin confirmar" };
    return { ok: true, url, label: "remoto" };
  }
  return { ok: true, url, label: `local (${describeDatabaseUrl(url)})` };
}

/** Pregunta en la terminal; sin terminal devuelve null (no se puede confirmar). */
export async function askInteractive(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Mensaje de error seguro: nunca la URL ni el texto de la excepción (puede traer credenciales). */
export function safeError(error: unknown): string {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  return code ? `error de base de datos (${code})` : "error inesperado";
}
