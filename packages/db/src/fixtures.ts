import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Datos del usuario: privados si existen, de ejemplo si no. El repo versiona un dataset de
 * ejemplo (golden anonimizado, perfil/criterios/niveles genéricos); los datos reales van en
 * `fixtures-private/` (ignorado por git) con el mismo formato y el seed y los evals los toman
 * de ahí cuando están. Es una decisión de diseño (repo público), no un repo incompleto.
 */
export type FixtureName = "golden" | "profile" | "criteria" | "skill_levels";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PUBLIC_PATHS: Record<FixtureName, string> = {
  golden: "evals/fixtures/golden.json",
  profile: "packages/db/seeds/profile.example.json",
  criteria: "packages/db/seeds/criteria.example.json",
  skill_levels: "packages/db/seeds/skill_levels.example.json",
};

export type LoadedFixture<T> = { data: T; source: "private" | "example"; path: string };

/**
 * `SEED_FIXTURES=example` ignora `fixtures-private/` y usa siempre los archivos de ejemplo (JS-065).
 * Cualquier otro valor no vacío es un error: un typo no debe cargar datos reales en silencio.
 * `root` es solo para tests.
 */
export function loadFixture<T>(name: FixtureName, root: string = ROOT): LoadedFixture<T> {
  const mode = process.env.SEED_FIXTURES?.trim();
  if (mode && mode !== "example") {
    throw new Error(`SEED_FIXTURES inválido: "${mode}". El único valor aceptado es "example".`);
  }
  const privatePath = resolve(root, "fixtures-private", `${name}.json`);
  const path =
    mode !== "example" && existsSync(privatePath) ? privatePath : resolve(root, PUBLIC_PATHS[name]);
  return {
    data: JSON.parse(readFileSync(path, "utf8")) as T,
    source: path === privatePath ? "private" : "example",
    path,
  };
}
