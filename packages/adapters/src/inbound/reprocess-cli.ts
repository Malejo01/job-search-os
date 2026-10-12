import {
  confirmRemoteTarget,
  createDb,
  describeDatabaseUrl,
  isRemoteDatabase,
  loadLocalEnv,
  requireDatabaseUrl,
} from "@job-search-os/db";
import { createLogger } from "../logger";
import type { EmailParser } from "./parsers";
import { reprocessManualQueue } from "./reprocess";

/**
 * tsx src/inbound/reprocess-cli.ts --parser eightfold [--local] [--user <uuid> | --todos] [--dry-run]
 * Contra la base remota hace falta --user o --todos.
 * Vuelve a pasar por el parser los emails de la cola manual cuyo remitente hoy lo elige. Sin LLM.
 * Con --dry-run solo cuenta (no ingesta ni actualiza). Contra la base remota, sin --dry-run, pide
 * confirmar con «si». Imprime solo conteos.
 */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const parser = flag("parser") as EmailParser["name"] | undefined;
  if (!parser) {
    console.error("falta --parser <nombre> (por ejemplo eightfold)");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const url = requireDatabaseUrl({ purpose: "service" });
  console.log(`→ ${describeDatabaseUrl(url)} · ${dryRun ? "dry-run (no escribe)" : "escribe"}`);
  // Contra una base remota, sin --user se reprocesan todas las personas: hay que pedirlo (--todos)
  const userId = flag("user");
  const todos = !userId && process.argv.includes("--todos");
  if (!userId && isRemoteDatabase(url) && !todos) {
    console.error("contra una base remota hace falta --user <uuid> o --todos (todos los usuarios)");
    process.exit(1);
  }
  const action = userId
    ? "reprocesar la cola manual de un usuario en"
    : "reprocesar la cola manual de todos los usuarios en";
  if (!dryRun && !(await confirmRemoteTarget(url, { action }))) {
    console.error("reprocess cancelado: no se tocó la base.");
    process.exit(1);
  }
  const { db, close } = createDb(url, { max: 2 });
  try {
    const result = await reprocessManualQueue(db, {
      parser,
      userId,
      dryRun,
      logger: createLogger({ job: "inbound:reprocess" }),
    });
    console.table([result]);
    if (dryRun) console.log("(nada escrito: sacá --dry-run para reprocesar)");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  // Solo el tipo de error: el mensaje puede traer la URL de la base o contenido de un email
  console.error("reprocess falló:", error instanceof Error ? error.name : "error desconocido");
  process.exit(1);
});
