import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Carpeta de los datos privados (`.env.local` y `fixtures-private/`).
 *
 * - Sin `JSO_PRIVATE_DIR` (o vacía): la raíz del repo, como siempre.
 * - Con `JSO_PRIVATE_DIR`: esa carpeta. Tiene que ser absoluta y existir. Si no, falla cerrado:
 *   una ruta relativa dependería del directorio desde donde se corre el comando, y un error de
 *   tipeo haría caer en silencio a otros datos o a ninguno.
 *
 * El mensaje de error no incluye la ruta configurada.
 * `env` y `repoRoot` son parámetros para poder probarlo sin tocar el entorno real.
 */
export function privateBaseDir(env: Record<string, string | undefined>, repoRoot: string): string {
  const raw = env.JSO_PRIVATE_DIR?.trim();
  if (!raw) return repoRoot;
  if (!isAbsolute(raw)) {
    throw new Error("JSO_PRIVATE_DIR tiene que ser una ruta absoluta.");
  }
  const dir = resolve(raw);
  if (!isDirectory(dir)) throw new Error("JSO_PRIVATE_DIR no es una carpeta existente.");
  return dir;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Ruta del `.env.local`. */
export function envLocalPath(env: Record<string, string | undefined>, repoRoot: string): string {
  return join(privateBaseDir(env, repoRoot), ".env.local");
}

/** Ruta de `fixtures-private/`. */
export function fixturesPrivateDir(
  env: Record<string, string | undefined>,
  repoRoot: string,
): string {
  return join(privateBaseDir(env, repoRoot), "fixtures-private");
}
