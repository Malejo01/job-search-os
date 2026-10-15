import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createDb, LOCAL_DATABASE_URL } from "@job-search-os/db";
import { safeDbError } from "../logging/safe-error";
import {
  explainDatabaseUrl,
  formatExplainReport,
  parseExplainArgs,
  parsePersona,
  runExplain,
  type Persona,
} from "./explain";

/**
 * Diagnóstico del pool de solo lectura (ronda 51):
 *   pnpm pool:explain --persona <ruta.json> [--limit 30] [--db snapshot|dev] [--why "<regex>"]...
 *   pnpm pool:explain --user <uuid>         [--limit 30] [--db snapshot|dev] [--why "<regex>"]...
 * Muestra qué ofertas elegiría hoy la asignación inicial y por qué. Se conecta SOLO a la base local
 * de Docker (`jobsearch_snapshot` por defecto, `jobsearch` con `--db dev`), armada desde
 * LOCAL_DATABASE_URL; ignora DATABASE_URL y cualquier otra variable, y aborta ante un host que no
 * sea localhost. La sesión corre en una transacción READ ONLY. No usa la cola, el worker ni el LLM.
 */
async function main(): Promise<void> {
  const parsed = parseExplainArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }
  const { args } = parsed;

  const target = explainDatabaseUrl(LOCAL_DATABASE_URL, args.db);
  if (!target.ok) {
    console.error(target.error);
    process.exitCode = 1;
    return;
  }

  let persona: Persona | null = null;
  let personaLabel = "";
  if (args.mode.kind === "persona") {
    let json: unknown;
    // `pnpm --filter` corre el script desde packages/adapters: la ruta se resuelve contra la carpeta
    // desde la que se lanzó el comando (INIT_CWD, que define pnpm), no contra la del paquete
    const personaPath = resolve(process.env.INIT_CWD ?? process.cwd(), args.mode.path);
    try {
      json = JSON.parse(readFileSync(personaPath, "utf8"));
    } catch {
      console.error("no se pudo leer la persona (archivo ausente o JSON inválido)");
      process.exitCode = 1;
      return;
    }
    const p = parsePersona(json);
    if (!p.ok) {
      console.error(p.error);
      process.exitCode = 1;
      return;
    }
    persona = p.persona;
    personaLabel = basename(args.mode.path);
  }

  const conn = createDb(target.url, { max: 1 });
  try {
    const report = await runExplain(conn.db, args, { persona, personaLabel, now: new Date() });
    console.log(
      `base: ${args.db === "dev" ? "jobsearch" : "jobsearch_snapshot"} (localhost, solo lectura)`,
    );
    console.log(formatExplainReport(report));
  } finally {
    await conn.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  const e = safeDbError(error);
  const message = error instanceof Error && !e.code ? ` (${error.message})` : "";
  console.error(`pool:explain falló: ${e.name}${e.code ? ` ${e.code}` : ""}${message}`);
  process.exit(1);
});
