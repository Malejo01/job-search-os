import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de sesión (S-6): `auth()` de Auth.js solo se usa en `apps/web/lib/session.ts`, que compara
 * la versión de sesión del JWT con la de la base. Una ruta o una acción que llame `auth()` directo
 * aceptaría una sesión de antes de un reset de contraseña. El resto usa `requireUserId`,
 * `sessionUserId` o sus variantes; de `@/auth` solo se importan `signIn`, `signOut` y `handlers`.
 */
const WEB_DIR = join(__dirname, "../../../apps/web");
const ALLOWED = ["lib/session.ts"];
const IMPORTS_AUTH = /import\s*\{[^}]*\bauth\b[^}]*\}\s*from\s*["'](@\/auth|\.\.?\/[./]*auth)["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next" || name === "e2e") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

describe("guarda de sesión (S-6)", () => {
  it("solo lib/session.ts importa auth() de @/auth", () => {
    const offenders = sourceFiles(WEB_DIR)
      .map((file) => relative(WEB_DIR, file).split(sep).join("/"))
      .filter((rel) => !ALLOWED.includes(rel))
      .filter((rel) => IMPORTS_AUTH.test(readFileSync(join(WEB_DIR, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("la guarda reconoce el import que tiene que frenar", () => {
    expect(IMPORTS_AUTH.test('import { auth } from "@/auth";')).toBe(true);
    expect(IMPORTS_AUTH.test('import { auth, signOut } from "@/auth";')).toBe(true);
    expect(IMPORTS_AUTH.test('import { signOut } from "@/auth";')).toBe(false);
    expect(IMPORTS_AUTH.test('import { authConfig } from "./auth.config";')).toBe(false);
  });
});
