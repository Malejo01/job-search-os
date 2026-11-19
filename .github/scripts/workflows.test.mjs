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

test("el cron no imprime la respuesta completa en el log público", () => {
  const { text } = workflows.find((w) => w.name === "cron.yml");
  assert.doesNotMatch(text, /jq \.\s*$/m);
  assert.doesNotMatch(text, /echo "\$body"; exit 1/);
});

test("el CI revisa las dependencias de producción", () => {
  const { text } = workflows.find((w) => w.name === "ci.yml");
  assert.match(text, /pnpm audit --prod --audit-level high/);
});
