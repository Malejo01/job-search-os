import {
  confirmRemoteTarget,
  createDb,
  describeDatabaseUrl,
  loadLocalEnv,
  requireDatabaseUrl,
  schema as s,
} from "@job-search-os/db";
import { parseApplicantFile } from "@job-search-os/pipeline";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncApplicant, type ApplicantSyncResult } from "./sync";

/**
 * pnpm applicant:sync [--local] [--apply] [--file ruta.json]
 * Carga hechos del perfil y respuestas fijas (JS-053) desde fixtures-private/applicant.json, o el
 * ejemplo del repo si no existe. Sin --apply solo muestra el diff. Contra una base remota pide
 * confirmar con "si" (o CONFIRM_PRODUCTION=si). Usuario: APPLICANT_USER_ID o el único de users.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function report(r: ApplicantSyncResult): void {
  const { facts, settings } = r;
  for (const f of facts.insert) console.log(`  + hecho ${f.key}: ${f.project} — ${f.claim}`);
  for (const u of facts.update) console.log(`  ~ hecho ${u.key}: ${u.fields.join(", ")}`);
  for (const k of facts.deactivate)
    console.log(`  - hecho ${k}: se desactiva (no está en el archivo)`);
  console.log(
    `hechos: ${facts.insert.length} nuevos, ${facts.update.length} cambiados, ${facts.deactivate.length} desactivados, ${facts.unchanged} sin cambios`,
  );
  console.log(
    settings.changed.length
      ? `respuestas fijas: ${settings.created ? "se crean" : "cambian"} ${settings.changed.join(", ")}`
      : "respuestas fijas: sin cambios",
  );
}

async function main(): Promise<void> {
  loadLocalEnv();
  const privatePath = resolve(ROOT, "fixtures-private/applicant.json");
  const path = arg("--file")
    ? resolve(process.env.INIT_CWD ?? process.cwd(), arg("--file")!)
    : existsSync(privatePath)
      ? privatePath
      : resolve(ROOT, "packages/db/seeds/applicant.example.json");
  const parsed = parseApplicantFile(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) {
    console.error(`✗ ${path} no es válido:\n  ${parsed.error.join("\n  ")}`);
    process.exit(1);
  }

  const apply = process.argv.includes("--apply");
  const url = requireDatabaseUrl({ purpose: "migration" });
  console.log(`→ ${describeDatabaseUrl(url)} · archivo ${path}${apply ? "" : " · solo diff"}`);
  if (apply && !(await confirmRemoteTarget(url, { action: "cargar hechos y respuestas fijas" }))) {
    console.error("applicant:sync cancelado: no se tocó la base.");
    process.exit(1);
  }

  const { db, close } = createDb(url, { max: 1 });
  try {
    let userId = process.env.APPLICANT_USER_ID ?? null;
    if (!userId) {
      const users = await db.select({ id: s.users.id }).from(s.users).limit(2);
      if (users.length !== 1) {
        throw new Error(`users tiene ${users.length} filas: definí APPLICANT_USER_ID`);
      }
      userId = users[0]!.id;
    }
    const result = await syncApplicant(db, { userId, file: parsed.value, apply });
    report(result);
    console.log(result.applied ? "✓ aplicado" : "(nada escrito: agregá --apply para aplicar)");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error("applicant:sync falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
