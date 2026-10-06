import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  loadPatterns,
  norm,
  report,
  scanDiff,
  scanLine,
  scanText,
  scanTree,
} from "../../../../scripts/privacy-scan.mjs";

/**
 * Barrido de privacidad (JS-063). Todo con patrones ficticios en un directorio temporal: el repo
 * público no trae patrones reales. Lo que se prueba es el matcher, no los datos.
 */
const SCRIPT = join(__dirname, "..", "..", "..", "..", "scripts", "privacy-scan.mjs");
const tmp: string[] = [];

function tmpDir(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `${name}-`));
  tmp.push(d);
  return d;
}

function patternsDir(opts: { map?: unknown; patterns?: string; allow?: string }): string {
  const dir = tmpDir("pats");
  if (opts.map !== undefined)
    writeFileSync(join(dir, "empresas.map.json"), JSON.stringify(opts.map));
  if (opts.patterns !== undefined) writeFileSync(join(dir, "privacy-patterns.txt"), opts.patterns);
  if (opts.allow !== undefined) writeFileSync(join(dir, "privacy-allow.txt"), opts.allow);
  return dir;
}

afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

describe("norm", () => {
  it("minúsculas y sin acentos", () => {
    expect(norm("ÁRBOL Ñandú")).toBe("arbol nandu");
  });
});

describe("matcher", () => {
  const pats = loadPatterns(
    patternsDir({ map: { "Contoso Ejemplo": "Empresa A" }, patterns: "# comentario\nFabrikam\n" }),
  );

  it("no distingue mayúsculas ni acentos", () => {
    expect(scanLine(pats, "trabajé en CONTOSO EJEMPLO")).toHaveLength(1);
    expect(scanLine(pats, "fabrikám")).toHaveLength(1);
    expect(scanLine(pats, "FABRIKAM")).toHaveLength(1);
  });

  it("palabra completa: no matchea dentro de otra palabra", () => {
    expect(scanLine(pats, "superfabrikamx")).toEqual([]);
    expect(scanLine(pats, "fabrikam2")).toEqual([]);
    expect(scanLine(pats, 'dijo "fabrikam", luego')).toHaveLength(1);
  });

  it("espacios flexibles: con guion, punto o pegado", () => {
    for (const s of ["contoso ejemplo", "contoso-ejemplo", "contoso_ejemplo", "contosoejemplo"]) {
      expect(scanLine(pats, s)).toHaveLength(1);
    }
  });

  it("los alias «Empresa X» no son patrones", () => {
    expect(scanLine(pats, "Empresa A contrató")).toEqual([]);
  });

  it("regex con re: y lookahead", () => {
    const re = loadPatterns(patternsDir({ patterns: "re:ref=(?!0000)[0-9a-f]{16}\n" }));
    expect(scanLine(re, "https://x.example/item?ref=1234abcd5678ef90")).toHaveLength(1);
    expect(scanLine(re, "https://x.example/item?ref=0000abcdef012345")).toEqual([]);
  });

  it("privacy-allow.txt ignora términos", () => {
    const sin = loadPatterns(patternsDir({ patterns: "Fabrikam\nContoso\n" }));
    const con = loadPatterns(
      patternsDir({ patterns: "Fabrikam\nContoso\n", allow: "# ok\nContoso\n" }),
    );
    expect(scanLine(sin, "contoso")).toHaveLength(1);
    expect(scanLine(con, "contoso")).toEqual([]);
    expect(scanLine(con, "fabrikam")).toHaveLength(1);
  });

  it("un directorio sin patrones carga una lista vacía", () => {
    expect(loadPatterns(join(tmpdir(), "no-existe-privacy-scan"))).toEqual([]);
  });

  it("scanText da la línea y scanDiff solo mira líneas agregadas", () => {
    expect(scanText(pats, "a.txt", "limpio\nuna fabrikam\n")).toEqual([
      { where: "a.txt:2", id: pats.find((p) => p.n === "fabrikam")!.id },
    ]);
    const diff = [
      "+++ b/src/x.ts",
      "@@ -1,0 +10,2 @@",
      "+nada",
      "+fabrikam",
      "-contoso ejemplo borrado",
    ].join("\n");
    const { hits, paths } = scanDiff(pats, diff);
    expect(paths).toEqual(["src/x.ts"]);
    expect(hits.map((h) => h.where)).toEqual(["src/x.ts:11"]);
  });

  it("el informe nunca incluye el texto del patrón", () => {
    const hits = scanText(pats, "a.txt", "fabrikam y contoso ejemplo");
    const out = report(hits, pats);
    expect(out).toContain("a.txt:1");
    expect(out).toContain("patrón #");
    expect(out.toLowerCase()).not.toContain("fabrikam");
    expect(out.toLowerCase()).not.toContain("contoso");
  });
});

describe("--tree", () => {
  function git(cwd: string, ...args: string[]) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args[0]} falló: ${r.stderr}`);
  }

  function repo(): string {
    const dir = tmpDir("repo");
    git(dir, "init", "-q");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "limpio.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "sucio.ts"), "// linea 1\n// habla de Fabrikam\n");
    git(dir, "add", ".");
    return dir;
  }

  function run(args: string[]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  it("marca el archivo que coincide, por archivo:línea, y no el que no", () => {
    const root = repo();
    const pats = loadPatterns(patternsDir({ patterns: "Fabrikam\n" }));
    const { hits, files } = scanTree(pats, root);
    expect(files).toBe(2);
    expect(hits.map((h) => h.where)).toEqual(["src/sucio.ts:2"]);
  });

  it("por CLI sale con 1 y no imprime el patrón ni la coincidencia", () => {
    const root = repo();
    const dir = patternsDir({ patterns: "Fabrikam\n" });
    const r = run(["--tree", "--root", root, "--patterns-dir", dir]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("src/sucio.ts:2");
    expect(r.err).not.toContain("src/limpio.ts");
    expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
  });

  it("por CLI sale con 0 si no hay coincidencias", () => {
    const root = repo();
    const dir = patternsDir({ patterns: "Wingtip\n" });
    const r = run(["--tree", "--root", root, "--patterns-dir", dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Sin hallazgos.");
  });

  it("sin directorio de patrones falla cerrado (código distinto de 0)", () => {
    const root = repo();
    const r = run(["--tree", "--root", root, "--patterns-dir", join(root, "no-existe")]);
    expect(r.code).toBe(2);
  });

  it("un directorio de patrones existente pero vacío, o solo con allow, también falla cerrado", () => {
    const root = repo();
    for (const dir of [patternsDir({}), patternsDir({ allow: "Fabrikam\n" })]) {
      expect(run(["--tree", "--root", root, "--patterns-dir", dir]).code).toBe(2);
    }
  });

  it("un empresas.map.json inválido sale con 2 sin citar su contenido", () => {
    const root = repo();
    const dir = tmpDir("pats");
    writeFileSync(join(dir, "empresas.map.json"), '{"Fabrikam-secreto": ');
    const r = run(["--tree", "--root", root, "--patterns-dir", dir]);
    expect(r.code).toBe(2);
    expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("secreto");
  });

  it("--root o --patterns-dir sin valor es un error de uso (código 1)", () => {
    const root = repo();
    const dir = patternsDir({ patterns: "Fabrikam\n" });
    expect(run(["--tree", "--root"]).code).toBe(1);
    const r = run(["--tree", "--root", root, "--patterns-dir"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Uso:");
    expect(run(["--tree", "--patterns-dir", dir, "--root"]).code).toBe(1);
  });

  it("una ruta prohibida versionada (.env, fixtures-private/) es hallazgo con id 0", () => {
    const root = repo();
    mkdirSync(join(root, "fixtures-private"));
    writeFileSync(join(root, ".env"), "X=1\n");
    writeFileSync(join(root, "fixtures-private", "x.json"), "{}\n");
    git(root, "add", "-f", ".");
    const pats = loadPatterns(patternsDir({ patterns: "Wingtip\n" }));
    const { hits } = scanTree(pats, root);
    expect(hits.filter((h) => h.id === 0).map((h) => h.where)).toEqual([
      ".env",
      "fixtures-private/x.json",
    ]);
    expect(report(hits, pats)).toContain("no puede publicarse");
  });

  it("--text-file por CLI: 1 si coincide, 0 si no", () => {
    const dir = patternsDir({ patterns: "Fabrikam\n" });
    const sucio = join(tmpDir("txt"), "pr.md");
    writeFileSync(sucio, "titulo\ncuerpo con FABRIKAM\n");
    const limpio = join(tmpDir("txt"), "pr.md");
    writeFileSync(limpio, "todo bien\n");
    const a = run(["--text-file", sucio, "--patterns-dir", dir]);
    expect(a.code).toBe(1);
    expect(a.err).toContain("pr.md:2");
    expect(`${a.out}${a.err}`.toLowerCase()).not.toContain("fabrikam");
    expect(run(["--text-file", limpio, "--patterns-dir", dir]).code).toBe(0);
  });

  it("sin --patterns-dir y sin fixtures-private/ en el repo también falla cerrado", () => {
    const root = repo();
    const r = run(["--tree", "--root", root]);
    expect(r.code).toBe(2);
  });
});
