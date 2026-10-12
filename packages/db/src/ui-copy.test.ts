import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda de copia para personas (ronda 28): ninguna pantalla le pide a un usuario correr comandos
 * ni le habla de archivos del repo. Recorre `apps/web/app/**\/*.tsx`, quita los comentarios y mira
 * solo el texto visible: texto JSX entre etiquetas y literales de cadena con al menos un espacio
 * (los imports y las rutas no tienen espacios).
 * Límite: es una regex conservadora, no un parser; un texto armado con concatenaciones o con
 * variables no se ve. Alcanza para las notas fijas, que son donde aparecieron.
 */
const APP_DIR = join(__dirname, "../../../apps/web/app");
const FORBIDDEN = /pnpm|seeds\/|--local|\.json/i;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

export function visibleTexts(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-zÁ-ú][^<>{}]*)</g)) out.push(m[1]!);
  for (const m of code.matchAll(/"([^"\n]* [^"\n]*)"|`([^`]* [^`]*)`/g)) out.push(m[1] ?? m[2]!);
  return out;
}

describe("texto visible de las pantallas", () => {
  it("el detector encuentra comandos y archivos en JSX y en cadenas", () => {
    expect(visibleTexts("<p>Generalo con <code>pnpm plan:build</code></p>").join("|")).toMatch(
      FORBIDDEN,
    );
    expect(visibleTexts('const t = "ver seeds/skills.json ahora";').join("|")).toMatch(FORBIDDEN);
  });

  it("ignora comentarios", () => {
    const src = `/** corre pnpm market:snapshot */\n// seeds/x.json\nconst a = 1;\n{/* --local */}`;
    expect(visibleTexts(src)).toEqual([]);
  });

  it("ninguna pantalla menciona pnpm, seeds/, --local ni archivos .json", () => {
    const hits: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      for (const text of visibleTexts(readFileSync(file, "utf8"))) {
        if (FORBIDDEN.test(text))
          hits.push(`${file.replace(APP_DIR, "app")}: ${text.trim().slice(0, 60)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
