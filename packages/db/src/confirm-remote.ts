import { createInterface } from "node:readline/promises";

/**
 * Salvaguarda de los scripts que escriben en la base (db:migrate, db:seed). El destino por
 * defecto es la nube (ADR-009), y el 2026-09-22 una migración pensada para Docker terminó en
 * producción sin revisión. Contra una base que no está en esta máquina hay que confirmar
 * escribiendo "si"; sin terminal para preguntar (un agente, un script), no corre, salvo que
 * quien lo lanza lo decida explícitamente con CONFIRM_PRODUCTION=si.
 *
 * El CI corre `pnpm db:migrate` contra su Postgres en localhost: eso no pregunta.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

export function isRemoteDatabase(url: string): boolean {
  try {
    return !LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    // Una URL que no se entiende se trata como remota: ante la duda, preguntar
    return true;
  }
}

export type ConfirmOptions = {
  /** Verbo de lo que se va a hacer: "migrar", "sembrar". */
  action: string;
  env?: Record<string, string | undefined>;
  interactive?: boolean;
  ask?: (question: string) => Promise<string>;
  log?: (message: string) => void;
};

async function askTerminal(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function confirmRemoteTarget(url: string, options: ConfirmOptions): Promise<boolean> {
  if (!isRemoteDatabase(url)) return true;
  const env = options.env ?? process.env;
  const log = options.log ?? console.error;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // se muestra tal cual
  }
  if (env.CONFIRM_PRODUCTION === "si") return true;
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY);
  if (!interactive) {
    log(
      `✗ Destino PRODUCCIÓN (${host}) y no hay terminal para confirmar: no se ${options.action === "migrar" ? "migra" : "hace"} nada.\n` +
        `  Para la base local: DB_TARGET=local (o --local).\n` +
        `  Si de verdad es producción, y ya se revisó el SQL: CONFIRM_PRODUCTION=si.`,
    );
    return false;
  }
  const answer = await (options.ask ?? askTerminal)(
    `Vas a ${options.action} PRODUCCIÓN (${host}). Escribí 'si' para confirmar: `,
  );
  return answer.trim().toLowerCase() === "si";
}
