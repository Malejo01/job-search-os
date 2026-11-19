// node --test .github/scripts/carril.test.mjs (lo corre el job lint-typecheck de ci.yml). También corre con
// `vitest run --globals`: en ese caso `test` es el global de vitest.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
const repoRoot = join(here, "..", "..");
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

/** Archivos del repo bajo `dir`, sin carpetas generadas. Rutas relativas a la raíz, con `/`. */
function walk(dir) {
  const skip = new Set(["node_modules", ".next", ".turbo", "dist", "coverage"]);
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return skip.has(entry.name) ? [] : walk(`${dir}/${entry.name}`);
    }
    return [`${dir}/${entry.name}`];
  });
}

test("todo archivo con una server action está en el carril rojo", () => {
  const actions = walk("apps/web").filter(
    (f) =>
      /\.tsx?$/.test(f) &&
      /^\s*["']use server["'];?\s*$/m.test(readFileSync(join(repoRoot, f), "utf8")),
  );
  assert.ok(actions.length > 0, "el recorrido no encontró ninguna server action");
  const red = new Set(redFiles(actions, patterns).map((h) => h.file));
  assert.deepEqual(
    actions.filter((f) => !red.has(f)),
    [],
  );
});

test("toda ruta de la API y todo archivo de RLS están en el carril rojo", () => {
  const routes = walk("apps/web/app/api").filter((f) => f.endsWith("/route.ts"));
  const rls = walk("packages/db/rls");
  assert.ok(routes.length > 0, "el recorrido no encontró ninguna ruta");
  assert.ok(rls.length > 0, "el recorrido no encontró ningún archivo de RLS");
  const files = [...routes, ...rls];
  const red = new Set(redFiles(files, patterns).map((h) => h.file));
  assert.deepEqual(
    files.filter((f) => !red.has(f)),
    [],
  );
});

test("todo vercel.json está en el carril rojo, también uno nuevo", () => {
  const configs = [...walk("apps"), ...walk("packages")].filter((f) => f.endsWith("/vercel.json"));
  assert.ok(configs.length > 0, "el recorrido no encontró ningún vercel.json");
  for (const f of [...configs, "vercel.json", "apps/otra/vercel.json"]) {
    assert.equal(redFiles([f], patterns).length, 1, f);
  }
});

for (const f of [
  ".gitleaksignore",
  ".gitleaks.toml",
  "apps/web/lib/admin-guard.ts",
  "apps/web/lib/admin-routes.ts",
  "apps/web/lib/route-access.ts",
  "apps/web/lib/assistant.ts",
  "apps/web/lib/cv-coach/access.ts",
  "apps/web/lib/profile-agent/access.ts",
  "apps/web/lib/user-plan.ts",
  "apps/web/lib/llm-service.ts",
  "apps/web/lib/setup.ts",
  "apps/web/lib/pool-reassign.ts",
  "apps/web/lib/evaluate-now.ts",
  "packages/adapters/src/cv-coach/review/sign.ts",
  "apps/web/app/descarga/route.ts",
]) {
  test(`rojo: ${f}`, () => {
    assert.equal(redFiles([f], patterns).length, 1, f);
  });
}

test("todo archivo que usa el rol de servicio, un lock global o la lista de admins está en el carril rojo", () => {
  // Marcas de los controles que deciden quién puede qué o cuánto se gasta. Los tests no cuentan: no deciden nada.
  const marks = [/purpose:\s*["']service["']/, /pg_advisory_xact_lock/, /ADMIN_EMAILS/, /is_app_admin/];
  const isTest = (f) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /\/(__tests__|e2e|fixtures)\//.test(f);
  const files = [...walk("apps"), ...walk("packages")].filter(
    (f) => /\.(m?[jt]sx?|sql)$/.test(f) && !isTest(f),
  );
  assert.ok(files.length > 100, "el recorrido no encontró el árbol esperado");
  const users = files.filter((f) => {
    const text = readFileSync(join(repoRoot, f), "utf8");
    return marks.some((re) => re.test(text));
  });
  assert.ok(users.length > 0, "el recorrido no encontró ningún archivo con esas marcas");
  const red = new Set(redFiles(users, patterns).map((h) => h.file));
  assert.deepEqual(
    users.filter((f) => !red.has(f)),
    [],
  );
});

test("los controles de seguridad de la S2 están en el carril rojo", () => {
  for (const f of [
    "apps/web/lib/login-credentials.ts",
    "apps/web/lib/security-headers.ts",
    "apps/web/lib/csp.ts",
    "apps/web/lib/close-sessions.ts",
    "apps/web/lib/session-cookie.ts",
    "packages/adapters/src/quota/person-quota.ts",
    "packages/pipeline/src/agent/gate.ts",
    "packages/pipeline/src/profile-agent/flag.ts",
    "packages/pipeline/src/cv-coach/flag.ts",
    "packages/pipeline/src/session-version.ts",
    "packages/adapters/src/cv-chat/reserve.ts",
    "packages/adapters/src/profile-agent/read/reserve.ts",
    "packages/adapters/src/profile-agent/gaps/reserve.ts",
    "packages/adapters/src/cv-coach/reserve.ts",
    "packages/adapters/src/cv-coach/nuevo-control.ts",
    "packages/adapters/src/cv-chat/nuevo-control.ts",
    "packages/adapters/src/profile-agent/nuevo-control.ts",
  ]) {
    assert.equal(redFiles([f], patterns).length, 1, f);
  }
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
