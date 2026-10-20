// node --test .github/scripts/carril.test.mjs (lo corre el job lint-typecheck de ci.yml). También corre con
// `vitest run --globals`: en ese caso `test` es el global de vitest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_FILES_LIMIT,
  decide,
  globToRegExp,
  parseCount,
  parsePatterns,
  printable,
  redFiles,
} from "./carril.mjs";

const { test } = globalThis.describe ? globalThis : await import("node:test");

const here = dirname(fileURLToPath(import.meta.url));
const patterns = parsePatterns(readFileSync(join(here, "..", "carril-rojo.txt"), "utf8"));
const base = { patterns, labels: ["carril-verde"], paused: false, sameRepo: true };
const run = (files, extra = {}) =>
  decide({ ...base, files, expectedCount: files.length, ...extra });

test("glob: ** cruza carpetas, * no", () => {
  assert.ok(globToRegExp("packages/db/drizzle/**").test("packages/db/drizzle/meta/_journal.json"));
  assert.ok(globToRegExp("apps/web/lib/session*").test("apps/web/lib/session.ts"));
  assert.ok(!globToRegExp("apps/web/lib/session*").test("apps/web/lib/session/x.ts"));
  assert.ok(globToRegExp("**/package.json").test("package.json"));
  assert.ok(globToRegExp("**/package.json").test("apps/web/package.json"));
  assert.ok(!globToRegExp("**/package.json").test("apps/web/package.json.bak"));
  // el punto es literal
  assert.ok(!globToRegExp("apps/web/next.config.ts").test("apps/web/nextXconfig.ts"));
});

test("un PR de UI con la etiqueta es verde", () => {
  const r = run([
    "apps/web/app/(app)/jobs/new/paste-form.tsx",
    "apps/web/e2e/42-pegar-aviso.spec.ts",
    "docs/CARRIL_VERDE.md",
  ]);
  assert.equal(r.green, true, r.reasons.join("; "));
});

for (const f of [
  "packages/db/drizzle/0027_x.sql",
  "packages/db/schema.ts",
  "packages/db/rls/0006_waitlist.sql",
  ".github/workflows/ci.yml",
  ".github/carril-rojo.txt",
  ".github/scripts/carril.mjs",
  "apps/web/auth.ts",
  "apps/web/auth.config.ts",
  "apps/web/middleware.ts",
  "apps/web/lib/session.ts",
  "packages/prompts/evaluate_job.md",
  "evals/run.ts",
  "packages/pipeline/src/decide.ts",
  "packages/pipeline/src/prefilter/prefilter.ts",
  "apps/web/content/legal/privacidad.md",
  "packages/adapters/src/retention/purge.ts",
  "apps/web/app/api/inbound/route.ts",
  "apps/web/app/api/cron/evaluate/route.ts",
  "packages/adapters/src/inbound/parsers.ts",
  "package.json",
  "apps/web/package.json",
  "pnpm-lock.yaml",
  "apps/web/next.config.ts",
  "docs/sql/rol-jobsearch-cron.sql",
  "packages/db/src/confirm-remote.ts",
  "apps/web/app/api/health/route.ts",
  "apps/web/app/(app)/jobs/[id]/actions.ts",
  "apps/web/app/onboarding/asistente/actions.ts",
  "scripts/privacy-scan.mjs",
  ".gitignore",
  "apps/web/tsconfig.json",
  "eslint.config.mjs",
  ".github/CODEOWNERS",
]) {
  test(`rojo: ${f}`, () => {
    const r = run(["apps/web/app/page.tsx", f]);
    assert.equal(r.green, false);
    assert.deepEqual(
      r.red.map((h) => h.file),
      [f],
    );
  });
}

test("sin etiqueta, en pausa o desde un fork: falla aunque no toque nada rojo", () => {
  const files = ["apps/web/app/page.tsx"];
  assert.equal(run(files, { labels: [] }).green, false);
  assert.equal(run(files, { paused: true }).green, false);
  assert.equal(run(files, { sameRepo: false }).green, false);
});

test("lista incompleta, de más, vacía o en el tope de la API: falla cerrado", () => {
  const files = ["apps/web/app/page.tsx"];
  assert.equal(run(files, { expectedCount: 2 }).green, false);
  assert.equal(run(files, { expectedCount: 0 }).green, false);
  assert.equal(run(files, { expectedCount: Number.NaN }).green, false);
  assert.equal(run([]).green, false);
  const many = Array.from({ length: API_FILES_LIMIT }, (_, i) => `docs/x${i}.md`);
  assert.equal(run(many).green, false);
});

test("CHANGED_FILES: solo dígitos; vacío no es 0", () => {
  assert.equal(parseCount("12"), 12);
  assert.ok(Number.isNaN(parseCount("")));
  assert.ok(Number.isNaN(parseCount(undefined)));
  assert.ok(Number.isNaN(parseCount("1e3")));
});

test("un renombre que saca un archivo del carril rojo cuenta como rojo", () => {
  // El nombre anterior va en `previous`: cuenta para el carril, no para el recuento
  const r = run(["apps/web/lib/schema-movido.ts"], { previous: ["packages/db/schema.ts"] });
  assert.equal(r.green, false);
  assert.deepEqual(
    r.red.map((h) => h.file),
    ["packages/db/schema.ts"],
  );
  // Los nombres anteriores no rellenan el recuento: 2 archivos con 1 en la lista sigue fallando
  const short = run(["docs/a.md"], { previous: ["docs/b.md"], expectedCount: 2 });
  assert.equal(short.green, false);
});

test("printable: sin backticks ni caracteres de control, cortado", () => {
  assert.equal(printable("a`b\nc"), "a?b?c");
  assert.equal(printable("x".repeat(300)).length, 200);
});

test("CODEOWNERS repite exactamente la lista roja", () => {
  const owners = readFileSync(join(here, "..", "CODEOWNERS"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [path, ...who] = l.split(/\s+/);
      assert.deepEqual(who, ["@Malejo01"], l);
      return path.replace(/^\//, "");
    });
  assert.deepEqual([...owners].sort(), [...patterns].sort());
});

test("rutas de la app que no son rojas siguen verdes", () => {
  for (const f of [
    "apps/web/app/(public)/page.tsx",
    "apps/web/app/(app)/jobs/[id]/source-attribution.tsx",
    "apps/web/lib/labels.ts",
    "packages/pipeline/src/pool/attribution.ts",
    "packages/adapters/src/sources/wwr.ts",
    "docs/MONITOREO.md",
  ]) {
    assert.equal(redFiles([f], patterns).length, 0, f);
  }
});
