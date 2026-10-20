// Carril verde (ronda 65): decide si un PR puede mergearse solo (auto-merge con squash).
// Pasa solo si el PR tiene la etiqueta `carril-verde`, viene del mismo repo, el auto-merge no está
// en pausa y no toca ningún path de `.github/carril-rojo.txt`. Cualquier otra cosa falla: los PR del
// carril rojo los mergea Mauro saltando el check (bypass de admin en el ruleset).
//
// Corre desde `pull_request_target`: el workflow y este script salen de `main`, nunca de la rama del
// PR, y el código del PR no se ejecuta ni se descarga. La lista de archivos viene de la API.
// Sin dependencias: Node 22 puro.
/* global console, process */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GREEN_LABEL = "carril-verde";

/** Patrones de carril-rojo.txt: uno por línea, sin comentarios ni vacías. */
export function parsePatterns(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/** Glob mínimo: `**` cruza carpetas, `*` no, el resto es literal. Anclado al path completo. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `**/` también matchea cero carpetas (`**/package.json` toma `package.json` de la raíz)
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/** Archivos del PR que caen en el carril rojo, con el patrón que los atrapó. */
export function redFiles(files, patterns) {
  const compiled = patterns.map((p) => [p, globToRegExp(p)]);
  const hits = [];
  for (const f of files) {
    const hit = compiled.find(([, re]) => re.test(f));
    if (hit) hits.push({ file: f, pattern: hit[0] });
  }
  return hits;
}

/** La API de archivos de un PR devuelve como mucho 3000: con eso o más, la lista no es confiable. */
export const API_FILES_LIMIT = 3000;

/**
 * Veredicto. `files` son los nombres actuales del PR y `previous` los nombres anteriores de los
 * renombrados (cuentan para el carril rojo, no para el recuento). `expectedCount` es `changed_files`
 * del evento: si no coincide con lo que devolvió la API, o llega al tope, falla cerrado.
 */
export function decide({
  files,
  previous = [],
  expectedCount,
  patterns,
  labels,
  paused,
  sameRepo,
}) {
  const reasons = [];
  if (!sameRepo) reasons.push("el PR viene de un fork");
  if (paused) reasons.push("el auto-merge está en pausa (variable AUTO_MERGE_PAUSED)");
  if (!labels.includes(GREEN_LABEL)) reasons.push(`no tiene la etiqueta ${GREEN_LABEL}`);
  if (
    !Number.isInteger(expectedCount) ||
    expectedCount <= 0 ||
    expectedCount >= API_FILES_LIMIT ||
    files.length !== expectedCount
  ) {
    reasons.push("no se pudo leer la lista completa de archivos");
  }
  const red = redFiles([...new Set([...files, ...previous])], patterns);
  if (red.length) reasons.push(`toca ${red.length} archivo(s) del carril rojo`);
  return { green: reasons.length === 0, reasons, red };
}

/** `CHANGED_FILES` del evento: solo dígitos. `Number("")` sería 0 y no NaN. */
export function parseCount(raw) {
  return /^\d+$/.test(raw ?? "") ? Number(raw) : Number.NaN;
}

/** Para el resumen: sin caracteres de control ni backticks, y cortado. */
export function printable(name) {
  // eslint-disable-next-line no-control-regex -- a propósito: se sacan los caracteres de control
  const CONTROL = /[\u0000-\u001f\u007f`]/g;
  return String(name).replace(CONTROL, "?").slice(0, 200);
}

function gh(args) {
  // Sin shell: los valores van como argumentos.
  return execFileSync("gh", args, { encoding: "utf8" });
}

function prFiles(repo, number) {
  const lines = (jq) =>
    gh(["api", "--paginate", `repos/${repo}/pulls/${number}/files?per_page=100`, "--jq", jq])
      .split("\n")
      .filter(Boolean);
  return {
    files: lines(".[] | .filename"),
    // Un renombre que saca un archivo del carril rojo tiene que contar como rojo
    previous: lines(".[] | .previous_filename // empty"),
  };
}

function main() {
  const env = process.env;
  const repo = env.REPO ?? "";
  const number = env.PR_NUMBER ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(number)) {
    console.error("carril: REPO o PR_NUMBER inválidos");
    process.exit(1);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const patterns = parsePatterns(readFileSync(join(root, "carril-rojo.txt"), "utf8"));
  const { files, previous } = prFiles(repo, number);
  const result = decide({
    files,
    previous,
    expectedCount: parseCount(env.CHANGED_FILES),
    patterns,
    labels: JSON.parse(env.LABELS || "[]"),
    paused: (env.AUTO_MERGE_PAUSED ?? "").toLowerCase() === "true",
    sameRepo: env.HEAD_REPO === repo,
  });
  // La lista de archivos puede ir atrasada respecto del push: si la punta del PR ya no es la del
  // evento, esta corrida no vale (el push nuevo dispara otra).
  const headNow = gh(["api", `repos/${repo}/pulls/${number}`, "--jq", ".head.sha"]).trim();
  if (!env.HEAD_SHA || headNow !== env.HEAD_SHA) {
    result.green = false;
    result.reasons.push("la punta del PR cambió durante el chequeo");
  }

  const lines = [
    result.green ? "### Carril verde ✅" : "### Carril rojo: lo mergea Mauro",
    "",
    ...result.reasons.map((r) => `- ${r}`),
    ...result.red.slice(0, 50).map((h) => `  - \`${printable(h.file)}\` (${h.pattern})`),
  ];
  console.log(lines.join("\n"));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  process.exit(result.green ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
