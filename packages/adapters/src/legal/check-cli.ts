import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runLegalCheck } from "./check";

/**
 * `pnpm legal:check` (C8-12). Lista los marcadores legales que faltan, con archivo y línea, contra las
 * variables del entorno (LEGAL_RESPONSABLE, LEGAL_DOMICILIO, LEGAL_EMAIL, LEGAL_LOG_DAYS). Con
 * `LEGAL_FINAL=1` sale con código 1 si queda alguno. Solo lee archivos: no toca la base ni la red.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const FILES = ["apps/web/content/legal/terminos.md", "apps/web/content/legal/privacidad.md"];

const result = runLegalCheck({
  files: FILES.map((path) => ({
    path: relative(ROOT, join(ROOT, path)),
    content: readFileSync(join(ROOT, path), "utf8"),
  })),
  env: process.env,
  final: process.env.LEGAL_FINAL === "1",
});
for (const line of result.lines) console.log(line);
if (!result.ok) {
  console.error("LEGAL_FINAL=1: quedan marcadores sin completar.");
  process.exit(1);
}
