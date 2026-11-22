// node --test .github/scripts/workflows.test.mjs (lo corre el job lint-typecheck de ci.yml). También corre con
// `vitest run --globals`: en ese caso `test` es el global de vitest.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { test } = globalThis.describe ? globalThis : await import("node:test");

/** Reglas de los workflows, leídas como texto: sin dependencias para parsear YAML. */
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "workflows");
const workflows = readdirSync(DIR)
  .filter((f) => f.endsWith(".yml"))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));

/** Acciones de terceros que todavía esperan su commit fijo. La lista solo puede achicarse. */
const PENDING_PIN = new Set(["gitleaks/gitleaks-action@v2", "pnpm/action-setup@v4"]);

const usesLines = (text) => [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);

/** Bloques de cada job: desde `  nombre:` hasta el siguiente job. */
function jobBlocks(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + 7);
  return body
    .split(/^(?= {2}[a-z][a-z0-9-]*:\s*$)/m)
    .filter((block) => /^ {2}[a-z]/.test(block))
    .map((block) => ({ job: block.trim().split(":")[0], block }));
}

test("hay workflows para revisar", () => {
  assert.ok(workflows.length >= 4);
});

test("las acciones de terceros van fijadas por commit", () => {
  for (const { name, text } of workflows) {
    for (const uses of usesLines(text)) {
      if (uses.startsWith("actions/") || PENDING_PIN.has(uses)) continue;
      assert.match(uses, /@[0-9a-f]{40}$/, `${name}: ${uses}`);
    }
  }
});

test("cada workflow arranca sin permisos", () => {
  for (const { name, text } of workflows) {
    assert.match(text, /^permissions: \{\}\s*$/m, name);
  }
});

test("cada job tiene un tiempo máximo", () => {
  for (const { name, text } of workflows) {
    for (const { job, block } of jobBlocks(text)) {
      assert.match(block, /^\s+timeout-minutes: \d+/m, `${name}: ${job}`);
    }
  }
});

test("los jobs con secretos de producción declaran su entorno", () => {
  const expected = { "ci.yml": "evals", "cron.yml": "cron", "smoke.yml": "smoke" };
  for (const [file, environment] of Object.entries(expected)) {
    const { text } = workflows.find((w) => w.name === file);
    assert.match(text, new RegExp(`^\\s+environment: ${environment}\\s*$`, "m"), file);
  }
});

/** Secretos que pagan llamadas a un modelo: GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY y similares. */
const MODEL_SECRET = /secrets\.[A-Z0-9_]*(GEMINI|ANTHROPIC|OPENAI|GOOGLE_API|LLM)[A-Z0-9_]*/;

test("ningún job con secretos de modelo corre en un pull_request: solo en push a main o a mano desde main", () => {
  let checked = 0;
  for (const { name, text } of workflows) {
    for (const { job, block } of jobBlocks(text)) {
      if (!MODEL_SECRET.test(block)) continue;
      checked++;
      // El `if` del job va antes de `steps:`; cualquier otro `if` de un paso no cuenta
      const header = block.split(/^\s+steps:/m)[0];
      const condition = header.match(/^\s+if:\s*(.+)$/m)?.[1] ?? "";
      assert.notEqual(
        condition,
        "",
        `${name}: ${job} usa un secreto de modelo y no tiene \`if\` a nivel de job`,
      );
      assert.doesNotMatch(condition, /pull_request/, `${name}: ${job} corre en pull_request`);
      assert.match(
        condition,
        /github\.ref == 'refs\/heads\/main'/,
        `${name}: ${job} no se limita a main`,
      );
      assert.match(
        condition,
        /github\.event_name == '(push|workflow_dispatch)'/,
        `${name}: ${job}`,
      );
      // Un pull_request_target le daría el secreto a código de un PR: tampoco
      assert.doesNotMatch(condition, /pull_request_target/, `${name}: ${job}`);
    }
  }
  assert.ok(
    checked > 0,
    "no se encontró ningún job con secretos de modelo: el test no está probando nada",
  );
});

test("el job evals corre con la clave del proveedor principal y Gemini solo de respaldo", () => {
  const { text } = workflows.find((w) => w.name === "ci.yml");
  const { block } = jobBlocks(text).find((j) => j.job === "evals");
  // Se saltea con aviso si falta la clave del principal; la de Gemini es opcional
  assert.match(block, /HAS_ANTHROPIC_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY != '' \}\}/);
  assert.match(block, /HAS_GEMINI_KEY: \$\{\{ secrets\.GEMINI_API_KEY != '' \}\}/);
  assert.match(
    block,
    /env\.HAS_ANTHROPIC_KEY != 'true'[\s\S]*?ANTHROPIC_API_KEY no está configurada/,
  );
  assert.doesNotMatch(block, /env\.HAS_GEMINI_KEY != 'true'/, "Gemini no condiciona la corrida");
  // Las claves solo entran en el paso que corre los evals, no en el entorno del job
  const jobEnv = block.split(/^\s+steps:/m)[0];
  assert.doesNotMatch(jobEnv, /ANTHROPIC_API_KEY: \$\{\{ secrets/);
  assert.match(block, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(
    block,
    /GEMINI_API_KEY: \$\{\{ env\.HAS_GEMINI_KEY == 'true' && secrets\.GEMINI_API_KEY \|\| '' \}\}/,
  );
});

test("ningún workflow se dispara con pull_request_target", () => {
  for (const { name, text } of workflows) {
    // `carril.yml` lo usa a propósito (corre desde main y no ve código del PR); no tiene secretos de modelo
    if (MODEL_SECRET.test(text)) assert.doesNotMatch(text, /pull_request_target/, name);
  }
});

test("el cron no imprime la respuesta completa en el log público", () => {
  const { text } = workflows.find((w) => w.name === "cron.yml");
  assert.doesNotMatch(text, /jq \.\s*$/m);
  assert.doesNotMatch(text, /echo "\$body"; exit 1/);
});

test("el CI revisa las dependencias de producción", () => {
  const { text } = workflows.find((w) => w.name === "ci.yml");
  assert.match(text, /pnpm audit --prod --audit-level high/);
});
