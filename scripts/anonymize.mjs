// Anonimización del dataset y de los docs. Corre sobre los datos reales (fixtures-private/) y
// escribe las versiones públicas. El mapa de empresas (nombre real → "Empresa X", identidad
// estable) vive en fixtures-private/empresas.map.json y NO se versiona: sin él este script no
// hace nada. Uso: node scripts/anonymize.mjs
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(import.meta.dirname, "..");
const PRIV = resolve(ROOT, "fixtures-private");
const MAP_PATH = resolve(PRIV, "empresas.map.json");
const log = (s) => process.stdout.write(`${s}\n`);

if (!existsSync(MAP_PATH) || !existsSync(resolve(PRIV, "golden.json"))) {
  log("faltan fixtures-private/golden.json o fixtures-private/empresas.map.json: nada que hacer");
  process.exit(1);
}
mkdirSync(resolve(PRIV, "reports"), { recursive: true });

// 1. Reportes de evals: siempre privados (traen la salida cruda del modelo sobre el golden real)
for (const f of readdirSync(resolve(ROOT, "evals/reports"))) {
  if (f.endsWith(".json"))
    renameSync(resolve(ROOT, "evals/reports", f), resolve(PRIV, "reports", f));
}

// 2. Reemplazo por mapa: nombres más largos primero, con límites de palabra
const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));
const entries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function anonymizeText(text) {
  let out = text;
  for (const [from, to] of entries) {
    const re = new RegExp(`(?<![A-Za-z0-9])${esc(from)}(?![A-Za-z0-9])`, "g");
    out = out.replace(re, to);
  }
  return out;
}

// 3. Golden público: empresas por mapa, estados genéricos, sin notas con hechos personales
const real = JSON.parse(readFileSync(resolve(PRIV, "golden.json"), "utf8"));
const overrides = existsSync(resolve(PRIV, "golden.overrides.json"))
  ? JSON.parse(readFileSync(resolve(PRIV, "golden.overrides.json"), "utf8"))
  : { estado: {}, fuente: {}, notas: {}, score_nota: {}, meta: {} };
const pub = JSON.parse(anonymizeText(JSON.stringify(real)));
Object.assign(pub.meta, overrides.meta);
for (const j of pub.jobs) {
  j.estado = overrides.estado[j.estado] ?? j.estado;
  if (overrides.fuente[j.fuente]) j.fuente = overrides.fuente[j.fuente];
  if (j.id in overrides.notas) {
    if (overrides.notas[j.id] === null) delete j.notas;
    else j.notas = overrides.notas[j.id];
  }
  if (j.id in overrides.score_nota) j.score_nota = overrides.score_nota[j.id];
}
// Formato: una oferta por línea, como el original
const jobsLines = pub.jobs.map((j) => "    " + JSON.stringify(j)).join(",\n");
const rest = { ...pub };
delete rest.jobs;
const head = JSON.stringify({ meta: pub.meta }, null, 2).replace(/\n}$/, "");
const tail = Object.entries(rest)
  .filter(([k]) => k !== "meta")
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(",\n");
writeFileSync(
  resolve(ROOT, "evals/fixtures/golden.json"),
  `${head},\n  "jobs": [\n${jobsLines}\n  ],\n${tail}\n}\n`,
);

// 4. Docs y tests: solo el reemplazo por mapa (lo demás se edita a mano)
const DOCS = [
  "docs/PRD.md",
  "docs/adr/006-deduplicacion.md",
  "docs/adr/011-disciplina-distinta-hunde-el-score.md",
  "docs/EVALUATOR_PROMPT_v1.md",
  "docs/sources/getonboard.md",
  "docs/TESTING_STRATEGY.md",
  "docs/USO_DIARIO.md",
  "docs/BACKLOG.md",
  "docs/LLM_COSTOS.md",
  "docs/AUDITORIA_2026-09-11.md",
  "packages/pipeline/src/normalize/company.test.ts",
  "packages/pipeline/src/dedup/dedup.test.ts",
  "packages/pipeline/src/prefilter/prefilter.test.ts",
  "packages/pipeline/src/decide.test.ts",
  "evals/src/metrics.test.ts",
  "packages/adapters/src/sources/getonboard.test.ts",
  "packages/adapters/src/worker/worker.integration.test.ts",
];
for (const f of DOCS) {
  const p = resolve(ROOT, f);
  const before = readFileSync(p, "utf8");
  const after = anonymizeText(before);
  if (after !== before) writeFileSync(p, after);
}
log("golden público escrito; reportes y datos reales en fixtures-private/");
