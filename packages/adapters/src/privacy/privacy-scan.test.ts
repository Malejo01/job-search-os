import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  loadPatterns,
  norm,
  report,
  scanDiff,
  scanHistory,
  scanLine,
  scanText,
  scanTree,
  scanWorktree,
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

/**
 * Entorno sin las variables que un hook de git deja puestas (GIT_DIR, GIT_INDEX_FILE...): si
 * vitest corre desde un hook, git actuaría sobre el repo de afuera y no sobre el temporal.
 */
const gitEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
  GIT_CONFIG_NOSYSTEM: "1",
});

/** git en un repo temporal, con identidad fija y sin hooks; devuelve stdout sin espacios finales. */
function commitGit(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    "git",
    [
      "-c",
      "user.name=Prueba",
      "-c",
      "user.email=prueba@example.com",
      // Sin hooks de la config global: el repo temporal no depende de la máquina
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, encoding: "utf8", env: gitEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${args[0]} falló: ${r.stderr}`);
  return r.stdout.trim();
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

describe("--pre-push", () => {
  const ZERO = "0".repeat(40);
  const git = commitGit;

  /** Repo temporal con un commit por contenido; devuelve los sha en orden. */
  function repo(contents: string[]): { root: string; shas: string[] } {
    const root = tmpDir("repo");
    git(root, "init", "-q");
    const shas = contents.map((text, i) => {
      writeFileSync(join(root, `a${i}.txt`), text);
      git(root, "add", ".");
      git(root, "commit", "-q", "--no-gpg-sign", "-m", `commit ${i}`);
      return git(root, "rev-parse", "HEAD");
    });
    return { root, shas };
  }

  function prePush(root: string, stdin: string, patterns = "Fabrikam\n") {
    const dir = patternsDir({ patterns });
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--pre-push", "--root", root, "--patterns-dir", dir],
      { encoding: "utf8", input: stdin, env: gitEnv() },
    );
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  const line = (local: string, remote: string) =>
    `refs/heads/feat/x ${local} refs/heads/feat/x ${remote}\n`;

  it("rama nueva (remote sha en ceros): OK con todos los commits", () => {
    const { root, shas } = repo(["uno\n", "dos\n", "tres\n"]);
    const r = prePush(root, line(shas[2]!, ZERO));
    expect(r.code).toBe(0);
    expect(r.out).toBe("pre-push: OK (3 commits)\n");
    expect(r.err).toBe("");
  });

  it("rama existente: cuenta solo los commits nuevos (remote..local)", () => {
    const { root, shas } = repo(["uno\n", "dos\n", "tres\n"]);
    const r = prePush(root, line(shas[2]!, shas[0]!));
    expect(r.code).toBe(0);
    expect(r.out).toBe("pre-push: OK (2 commits)\n");
  });

  it("varias refs en un push: suma los commits de cada una", () => {
    const { root, shas } = repo(["uno\n", "dos\n", "tres\n"]);
    const r = prePush(root, line(shas[2]!, shas[1]!) + line(shas[1]!, shas[0]!));
    expect(r.code).toBe(0);
    expect(r.out).toBe("pre-push: OK (2 commits)\n");
  });

  it("solo borrado de rama (local sha en ceros): OK con 0 commits", () => {
    const { root, shas } = repo(["uno\n"]);
    const r = prePush(root, line(ZERO, shas[0]!));
    expect(r.code).toBe(0);
    expect(r.out).toBe("pre-push: OK (0 commits)\n");
  });

  it("con hallazgos: mismo mensaje de error que antes y sin OK", () => {
    const { root, shas } = repo(["uno\n", "habla de Fabrikam\n"]);
    const r = prePush(root, line(shas[1]!, ZERO));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "[pre-push] Push frenado por privacidad. 1 hallazgo(s):\n" +
        `  commit ${shas[1]!.slice(0, 8)} a1.txt:1 · patrón #1 (privacy-patterns.txt)\n` +
        "Arreglá con alias y rehacé los commits afectados.\n",
    );
  });

  it("una rama remota con un patrón en el nombre se marca sin citar el nombre", () => {
    const { root, shas } = repo(["uno\n"]);
    const r = prePush(root, `refs/heads/x ${shas[0]!} refs/heads/fabrikam-x ${ZERO}\n`);
    expect(r.code).toBe(1);
    expect(r.err).toContain("rama remota (ref 1 del push):1");
    expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
  });
});

/**
 * N4-1: el barrido falla cerrado. Lo que no puede leer o parsear es un hallazgo (id 0) o un error
 * con código distinto de 0; nunca un «Sin hallazgos» por omisión.
 */
describe("falla cerrado", () => {
  const pats = loadPatterns(patternsDir({ patterns: "Fabrikam\n" }));
  const FAB = pats[0]!.id;
  const closed = (where: string) => ({
    where,
    id: 0,
    why: expect.stringContaining("falla cerrado"),
  });

  /** CLI con un entorno git limpio que no sube más allá del directorio temporal. */
  function cli(args: string[], input = "") {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      input,
      env: { ...gitEnv(), GIT_CEILING_DIRECTORIES: tmpdir() },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  /** Repo temporal con un único commit con esos archivos y ese mensaje. */
  function oneCommit(files: Record<string, string>, msg = "commit"): { root: string; sha: string } {
    return oneCommitIn(tmpDir("repo"), files, msg);
  }

  function oneCommitIn(
    root: string,
    files: Record<string, string>,
    msg = "commit",
  ): { root: string; sha: string } {
    mkdirSync(root, { recursive: true });
    commitGit(root, "init", "-q");
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), text);
    }
    commitGit(root, "add", ".");
    commitGit(root, "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", msg);
    return { root, sha: commitGit(root, "rev-parse", "HEAD") };
  }

  describe("historia (scanHistory)", () => {
    it("un \\x1e o \\x1f en una línea agregada no corta el commit: se detecta y cuenta 1", () => {
      const { root, sha } = oneCommit({ "a.txt": "uno\n\x1e\x1f\nhabla de Fabrikam\n" });
      const { hits, commits } = scanHistory(pats, ["--all"], root);
      expect(commits).toBe(1);
      expect(hits).toEqual([{ where: `commit ${sha.slice(0, 8)} a.txt:3`, id: FAB }]);
    });

    it("un mensaje de commit con \\x1e y \\x1f se revisa entero", () => {
      const { root, sha } = oneCommit(
        { "a.txt": "limpio\n" },
        "titulo \x1e medio \x1f\n\nhabla de Fabrikam",
      );
      const { hits, commits } = scanHistory(pats, ["--all"], root);
      expect(commits).toBe(1);
      expect(hits).toEqual([{ where: `commit ${sha.slice(0, 8)} (mensaje):3`, id: FAB }]);
    });

    it("si los commits del log no cuadran con rev-list, es hallazgo id 0", () => {
      // Con -m, git log repite el merge una vez por padre: 5 bloques para 4 commits.
      const { root } = oneCommit({ "a.txt": "uno\n" });
      commitGit(root, "checkout", "-q", "-b", "otra");
      writeFileSync(join(root, "b.txt"), "dos\n");
      commitGit(root, "add", ".");
      commitGit(root, "commit", "-q", "--no-gpg-sign", "-m", "b");
      commitGit(root, "checkout", "-q", "-");
      writeFileSync(join(root, "c.txt"), "tres\n");
      commitGit(root, "add", ".");
      commitGit(root, "commit", "-q", "--no-gpg-sign", "-m", "c");
      commitGit(root, "merge", "-q", "--no-edit", "--no-gpg-sign", "otra");
      expect(scanHistory(pats, ["--all"], root).hits).toEqual([]);
      expect(scanHistory(pats, ["-m", "--all"], root).hits).toContainEqual(
        closed("historia de git"),
      );
    });

    it("por CLI: detecta lo que sigue al \\x1e, sale con 1 y no cita el patrón", () => {
      const { root, sha } = oneCommit({ "a.txt": "uno\n\x1e\nhabla de Fabrikam\n" });
      const dir = patternsDir({ patterns: "Fabrikam\n" });
      const r = cli(["--history", "--all", "--root", root, "--patterns-dir", dir]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("Commits revisados: 1");
      expect(r.err).toContain(`commit ${sha.slice(0, 8)} a.txt:3`);
      expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    });
  });

  describe("diff (scanDiff)", () => {
    const header = ["diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts"];

    it("una línea agregada «++ /dev/null» es contenido, no cabecera", () => {
      const diff = [...header, "@@ -1,0 +2,3 @@", "+++ /dev/null", "+fabrikam", "+fin", ""];
      expect(scanDiff(pats, diff.join("\n"))).toEqual({
        hits: [{ where: "src/x.ts:3", id: FAB }],
        paths: ["src/x.ts"],
      });
    });

    it("una línea agregada «++ b/pnpm-lock.yaml» no cambia de archivo", () => {
      const diff = [...header, "@@ -1,0 +2,2 @@", "+++ b/pnpm-lock.yaml", "+fabrikam", ""];
      expect(scanDiff(pats, diff.join("\n"))).toEqual({
        hits: [{ where: "src/x.ts:3", id: FAB }],
        paths: ["src/x.ts"],
      });
    });

    it("con contexto y varios hunks, los números de línea siguen al hunk", () => {
      const diff = [
        ...header,
        "@@ -1,2 +1,3 @@",
        " igual",
        "-viejo",
        "+++ nuevo",
        "+fabrikam",
        "@@ -9 +10 @@",
        "-otro",
        "+ fabrikam",
        "diff --git a/z.txt b/z.txt",
        "--- a/z.txt",
        "+++ b/z.txt",
        "@@ -0,0 +1 @@",
        "+fabrikam",
        "\\ No newline at end of file",
      ];
      expect(scanDiff(pats, diff.join("\n"), "p ")).toEqual({
        hits: [
          { where: "p src/x.ts:3", id: FAB },
          { where: "p src/x.ts:10", id: FAB },
          { where: "p z.txt:1", id: FAB },
        ],
        paths: ["src/x.ts", "z.txt"],
      });
    });

    it("un hunk cortado (faltan líneas) es hallazgo id 0", () => {
      const diff = ["+++ b/src/x.ts", "@@ -0,0 +1,3 @@", "+uno", ""].join("\n");
      expect(scanDiff(pats, diff).hits).toEqual([closed("src/x.ts")]);
    });

    it("una línea agregada fuera de un hunk es hallazgo id 0", () => {
      const diff = ["+++ b/src/x.ts", "+fabrikam", ""].join("\n");
      expect(scanDiff(pats, diff).hits).toEqual([closed("src/x.ts")]);
    });

    it("un binario sin extensión conocida es hallazgo id 0; uno de SKIP_FILES no", () => {
      const bin = (f: string) => [
        `diff --git a/${f} b/${f}`,
        "new file mode 100644",
        "index 0000000..20b5be9",
        `Binary files /dev/null and b/${f} differ`,
      ];
      const diff = [...bin("datos.dat"), ...bin("logo.png"), ""].join("\n");
      expect(scanDiff(pats, diff)).toEqual({
        hits: [closed("datos.dat")],
        paths: ["datos.dat", "logo.png"],
      });
    });

    it("un archivo nuevo vacío (sin hunk) también figura en paths", () => {
      const diff = ["diff --git a/.env b/.env", "new file mode 100644", "index 0000000..e69de29"];
      expect(scanDiff(pats, diff.join("\n")).paths).toEqual([".env"]);
    });
  });

  describe("errores de git", () => {
    it("scanTree y scanWorktree fuera de un repo git lanzan en vez de dar 0 hallazgos", () => {
      const noRepo = tmpDir("norepo");
      expect(() => scanTree(pats, noRepo)).toThrow();
      expect(() => scanWorktree(pats, noRepo)).toThrow();
    });

    it("por CLI fuera de un repo: --hook sale con 2, --tree y el modo por defecto con ≠ 0", () => {
      const noRepo = tmpDir("norepo");
      writeFileSync(join(noRepo, "a.txt"), "habla de Fabrikam\n");
      const dir = patternsDir({ patterns: "Fabrikam\n" });
      const hook = cli(["--hook", "--root", noRepo, "--patterns-dir", dir], "{}");
      expect(hook.code).toBe(2);
      for (const mode of [["--tree"], []]) {
        const r = cli([...mode, "--root", noRepo, "--patterns-dir", dir]);
        expect(r.code).not.toBe(0);
        expect(r.code).not.toBeNull();
        expect(r.out).not.toContain("Sin hallazgos");
        expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
      }
    });
  });

  describe("archivos que no se pueden revisar", () => {
    function treeRepo(): string {
      const root = tmpDir("repo");
      commitGit(root, "init", "-q");
      writeFileSync(join(root, "limpio.txt"), "nada\n");
      return root;
    }

    it("--tree: un symlink versionado se revisa por su destino (lo que se publica), aunque esté roto", () => {
      const root = treeRepo();
      symlinkSync("no-existe.txt", join(root, "roto"));
      symlinkSync("notas de Fabrikam.txt", join(root, "enlace"));
      commitGit(root, "add", ".");
      const { hits, files } = scanTree(pats, root);
      expect(files).toBe(3);
      expect(hits).toEqual([{ where: "enlace:1", id: FAB }]);
    });

    it("--tree: un archivo versionado ausente del disco se lee del índice", () => {
      const root = treeRepo();
      writeFileSync(join(root, "borrado.txt"), "habla de Fabrikam\n");
      writeFileSync(join(root, "borrado.dat"), "a\0b");
      commitGit(root, "add", ".");
      rmSync(join(root, "borrado.txt"));
      rmSync(join(root, "borrado.dat"));
      expect(scanTree(pats, root).hits).toEqual([
        closed("borrado.dat"),
        { where: "borrado.txt:1", id: FAB },
      ]);
    });

    it("--tree: un archivo con NUL sin extensión conocida es hallazgo id 0; un .png no", () => {
      const root = treeRepo();
      writeFileSync(join(root, "raro.dat"), "a\0Fabrikam\n");
      writeFileSync(join(root, "logo.png"), "a\0Fabrikam\n");
      commitGit(root, "add", ".");
      expect(scanTree(pats, root).hits).toEqual([closed("raro.dat")]);
    });

    it("--tree: un archivo de más de 2 MB es hallazgo id 0", () => {
      const root = treeRepo();
      writeFileSync(join(root, "grande.txt"), "a".repeat(2 * 1024 * 1024 + 1));
      commitGit(root, "add", ".");
      expect(scanTree(pats, root).hits).toEqual([closed("grande.txt")]);
    });

    it("sin trackear: un binario es hallazgo id 0; un symlink se revisa por su destino", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      writeFileSync(join(root, "raro.dat"), "a\0b");
      symlinkSync("no-existe.txt", join(root, "roto"));
      symlinkSync("Fabrikam.txt", join(root, "enlace"));
      const { hits } = scanWorktree(pats, root);
      expect(hits).toEqual([
        { where: "sin trackear enlace:1", id: FAB },
        closed("sin trackear raro.dat"),
      ]);
    });

    it("sin trackear: un repo anidado (directorio) no es hallazgo", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      oneCommitIn(join(root, "anidado"), { "b.txt": "dos\n" });
      expect(scanWorktree(pats, root).hits).toEqual([]);
    });

    it("el informe de un hallazgo id 0 dice dónde y por qué, sin contenido", () => {
      const root = treeRepo();
      writeFileSync(join(root, "raro.dat"), "a\0Fabrikam\n");
      commitGit(root, "add", ".");
      const dir = patternsDir({ patterns: "Fabrikam\n" });
      const r = cli(["--tree", "--root", root, "--patterns-dir", dir]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("raro.dat · ");
      expect(r.err).toContain("falla cerrado");
      expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    });
  });

  describe("merges, config de git y nombres de archivo", () => {
    /** Commit de todo lo que haya en el árbol. */
    const commitAll = (root: string, msg: string) => {
      commitGit(root, "add", "-A");
      commitGit(root, "commit", "-q", "--no-gpg-sign", "-m", msg);
      return commitGit(root, "rev-parse", "HEAD");
    };

    it("un merge con conflicto resuelto y un archivo nuevo se revisa (--remerge-diff)", () => {
      const { root } = oneCommit({ "a.txt": "base\n" });
      commitGit(root, "checkout", "-q", "-b", "otra");
      writeFileSync(join(root, "a.txt"), "otra\n");
      commitAll(root, "otra");
      commitGit(root, "checkout", "-q", "-");
      writeFileSync(join(root, "a.txt"), "principal\n");
      commitAll(root, "principal");
      spawnSync("git", ["merge", "-q", "otra"], { cwd: root, env: gitEnv() }); // conflicto
      writeFileSync(join(root, "a.txt"), "resuelto con Fabrikam\n");
      writeFileSync(join(root, "nuevo.txt"), "agregado en el merge: Fabrikam\n");
      const merge = commitAll(root, "merge").slice(0, 8);
      const { hits, commits } = scanHistory(pats, ["--all"], root);
      expect(commits).toBe(4);
      expect(hits).toEqual([
        { where: `commit ${merge} a.txt:1`, id: FAB },
        { where: `commit ${merge} nuevo.txt:1`, id: FAB },
      ]);
    });

    it("diff.mnemonicPrefix no esconde una ruta prohibida sin commitear", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      commitGit(root, "config", "diff.mnemonicPrefix", "true");
      mkdirSync(join(root, "fixtures-private"));
      writeFileSync(join(root, "fixtures-private", "x.json"), "{}\n");
      commitGit(root, "add", "-f", "fixtures-private/x.json");
      expect(scanWorktree(pats, root).hits).toContainEqual(
        expect.objectContaining({ where: "sin commitear fixtures-private/x.json", id: 0 }),
      );
    });

    it("diff.noprefix y un renombre a fixtures-private/ no esconden la ruta en la historia", () => {
      const { root } = oneCommit({ "notas.txt": "uno\n" });
      commitGit(root, "config", "diff.noprefix", "true");
      mkdirSync(join(root, "fixtures-private"));
      commitGit(root, "mv", "notas.txt", "fixtures-private/notas.txt");
      const sha = commitAll(root, "mover").slice(0, 8);
      expect(scanHistory(pats, ["--all"], root).hits).toContainEqual(
        expect.objectContaining({ where: `commit ${sha} fixtures-private/notas.txt`, id: 0 }),
      );
    });

    it("log.showRoot=false no esconde el commit raíz", () => {
      const { root, sha } = oneCommit({ "a.txt": "habla de Fabrikam\n" });
      commitGit(root, "config", "log.showRoot", "false");
      expect(scanHistory(pats, ["--all"], root).hits).toEqual([
        { where: `commit ${sha.slice(0, 8)} a.txt:1`, id: FAB },
      ]);
    });

    it("un nombre de archivo con un patrón es hallazgo aunque el contenido esté limpio", () => {
      const { root, sha } = oneCommit({ "notas-fabrikám.txt": "limpio\n", "b.txt": "x\n" });
      expect(scanTree(pats, root).hits).toEqual([{ where: "notas-fabrikám.txt", id: FAB }]);
      expect(scanHistory(pats, ["--all"], root).hits).toEqual([
        { where: `commit ${sha.slice(0, 8)} notas-fabrikám.txt`, id: FAB },
      ]);
    });

    it("el informe no cita un patrón ni en la ubicación", () => {
      const both = patternsDir({ patterns: "Fabrikam\nContoso\n" });
      const { root } = oneCommit({ "a.txt": "uno\n" });
      writeFileSync(join(root, "fabrikam.dat"), "a\0b");
      writeFileSync(join(root, "contoso-cv.md"), "habla de Fabrikam\n");
      const r = cli(["--root", root, "--patterns-dir", both]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("ubicación con dato privado (n.º 1)");
      expect(r.err).toContain("ubicación con dato privado (n.º 2)");
      const all = `${r.out}${r.err}`.toLowerCase();
      expect(all).not.toContain("fabrikam");
      expect(all).not.toContain("contoso");
    });

    it("un error de git que cita un patrón no se imprime (código 2)", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      const dir = patternsDir({ patterns: "Fabrikam\n" });
      const r = cli(["--history", "fabrikam-x..HEAD", "--root", root, "--patterns-dir", dir]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("detalle omitido");
      expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    });

    it("--hook no cita una tarea cuyo título tiene un patrón", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      writeFileSync(join(root, "b.txt"), "habla de Fabrikam\n");
      const dir = patternsDir({ patterns: "Fabrikam\n" });
      const r = cli(
        ["--hook", "--root", root, "--patterns-dir", dir],
        JSON.stringify({ task_subject: "tarea de Fabrikam" }),
      );
      expect(r.code).toBe(2);
      expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    });
  });

  describe("CLI: más caminos que fallaban abierto", () => {
    const dir = () => patternsDir({ patterns: "Fabrikam\n" });

    it("sin main ni origin/main, el modo por defecto y --hook revisan HEAD --not --remotes", () => {
      const root = tmpDir("repo");
      commitGit(root, "init", "-q", "-b", "trabajo");
      writeFileSync(join(root, "a.txt"), "habla de Fabrikam\n");
      commitGit(root, "add", ".");
      commitGit(root, "commit", "-q", "--no-gpg-sign", "-m", "uno");
      const d = dir();
      const def = cli(["--root", root, "--patterns-dir", d]);
      expect(def.code).toBe(1);
      expect(def.err).toContain("a.txt:1");
      expect(cli(["--hook", "--root", root, "--patterns-dir", d], "{}").code).toBe(2);
    });

    it("--text-file sin archivos es un error de uso (1)", () => {
      expect(cli(["--text-file", "--patterns-dir", dir()]).code).toBe(1);
    });

    it("una regex inválida en privacy-patterns.txt sale con 2 sin citarla", () => {
      const root = oneCommit({ "a.txt": "uno\n" }).root;
      const bad = patternsDir({ patterns: "Wingtip\nre:fabrikam(\n" });
      const r = cli(["--tree", "--root", root, "--patterns-dir", bad]);
      expect(r.code).toBe(2);
      expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    });

    it("--pre-push con un sha que no es hex sale con 2 sin pasarlo a git", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      const r = cli(
        ["--pre-push", "--root", root, "--patterns-dir", dir()],
        `refs/heads/x HEAD refs/heads/x ${"0".repeat(40)}\n`,
      );
      expect(r.code).toBe(2);
      expect(r.out).not.toContain("OK");
    });

    it("invocado por un symlink, igual corre (no sale con 0 sin revisar)", () => {
      const link = join(tmpDir("bin"), "privacy-scan.mjs");
      symlinkSync(SCRIPT, link);
      const r = spawnSync(
        process.execPath,
        [link, "--tree", "--root", tmpDir("norepo"), "--patterns-dir", dir()],
        { encoding: "utf8", env: { ...gitEnv(), GIT_CEILING_DIRECTORIES: tmpdir() } },
      );
      expect(r.status).toBe(2);
    });

    it("--history con un patrón de refs que no resuelve ninguna ref sale con 2", () => {
      const { root } = oneCommit({ "a.txt": "uno\n" });
      const run = (...rev: string[]) =>
        cli(["--history", ...rev, "--root", root, "--patterns-dir", dir()]);
      const r = run("--glob=refs/nada/*");
      expect(r.code).toBe(2);
      expect(r.err).toContain("no se revisó ningún commit");
      // Con refs que existen, 0 commits es válido; también un rango vacío explícito.
      expect(run("--all", "--not", "--all").code).toBe(0);
      expect(run("--branches", "--not", "--all").code).toBe(0);
      expect(run("HEAD..HEAD").code).toBe(0);
    });
  });

  describe("ronda 3: arreglar una fuga, octopus y ubicaciones", () => {
    const commitAll = (root: string, msg: string) => {
      commitGit(root, "add", "-A");
      commitGit(root, "commit", "-q", "--no-gpg-sign", "-m", msg);
      return commitGit(root, "rev-parse", "HEAD");
    };

    /** main con una ruta prohibida y una ruta con patrón (contenido limpio); rama `arreglo`. */
    function leakRepo(): { root: string; main: string } {
      const root = tmpDir("repo");
      commitGit(root, "init", "-q", "-b", "main");
      mkdirSync(join(root, "fixtures-private"));
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "fixtures-private", "leak.txt"), "uno\n");
      writeFileSync(join(root, "docs", "Fabrikam-notas.md"), "dos\n");
      writeFileSync(join(root, "a.txt"), "tres\n");
      commitGit(root, "add", "-f", ".");
      commitGit(root, "commit", "-q", "--no-gpg-sign", "-m", "fuga");
      const main = commitGit(root, "rev-parse", "HEAD");
      commitGit(root, "checkout", "-q", "-b", "arreglo");
      return { root, main };
    }

    const fixes: Record<string, string[][]> = {
      borrar: [
        ["rm", "-q", "fixtures-private/leak.txt"],
        ["rm", "-q", "docs/Fabrikam-notas.md"],
      ],
      "renombrar a alias": [
        ["mv", "fixtures-private/leak.txt", "docs/leak.txt"],
        ["mv", "docs/Fabrikam-notas.md", "docs/empresa-a.md"],
      ],
    };

    for (const [name, cmds] of Object.entries(fixes)) {
      it(`${name} una ruta prohibida o con patrón no es hallazgo (commiteado)`, () => {
        const { root, main } = leakRepo();
        for (const c of cmds) commitGit(root, ...c);
        const head = commitAll(root, "arreglo");
        const d = patternsDir({ patterns: "Fabrikam\n" });
        const def = cli(["--root", root, "--patterns-dir", d]);
        expect(def.err).toBe("");
        expect(def.code).toBe(0);
        const pp = cli(
          ["--pre-push", "--root", root, "--patterns-dir", d],
          `refs/heads/arreglo ${head} refs/heads/arreglo ${main}\n`,
        );
        expect(pp.out).toBe("pre-push: OK (1 commits)\n");
        expect(pp.code).toBe(0);
      });

      it(`${name} una ruta prohibida o con patrón no es hallazgo (sin commitear)`, () => {
        const { root } = leakRepo();
        for (const c of cmds) commitGit(root, ...c);
        const r = cli(["--root", root, "--patterns-dir", patternsDir({ patterns: "Fabrikam\n" })]);
        expect(r.err).toBe("");
        expect(r.code).toBe(0);
      });
    }

    it("un merge octopus (más de dos padres) es hallazgo id 0", () => {
      const { root } = oneCommit({ "a.txt": "base\n" });
      for (const b of ["b1", "b2"]) {
        commitGit(root, "checkout", "-q", "-b", b);
        writeFileSync(join(root, `${b}.txt`), `${b}\n`);
        commitAll(root, b);
        commitGit(root, "checkout", "-q", "-");
      }
      commitGit(root, "merge", "-q", "--no-ff", "--no-edit", "--no-gpg-sign", "b1", "b2");
      const sha = commitGit(root, "rev-parse", "HEAD").slice(0, 8);
      const { hits, commits } = scanHistory(pats, ["--all"], root);
      expect(commits).toBe(4);
      expect(hits).toEqual([closed(`commit ${sha}`)]);
    });

    it("el informe oculta solo la ruta: conserva commit y línea", () => {
      const { root, sha } = oneCommit({ "notas-fabrikam.txt": "uno\ndos\nhabla de Fabrikam\n" });
      const r = cli([
        "--history",
        "--all",
        "--root",
        root,
        "--patterns-dir",
        patternsDir({ patterns: "Fabrikam\n" }),
      ]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`commit ${sha.slice(0, 8)} ubicación con dato privado (n.º 1):3 ·`);
      expect(r.err).toContain(`commit ${sha.slice(0, 8)} ubicación con dato privado (n.º 1) ·`);
      expect(`${r.out}${r.err}`.toLowerCase()).not.toContain("fabrikam");
    });

    it("una regex que coincide con el sha no oculta la ubicación", () => {
      const { root, sha } = oneCommit({ "limpio.txt": "token cafebabe\n" });
      const r = cli([
        "--history",
        "--all",
        "--root",
        root,
        "--patterns-dir",
        patternsDir({ patterns: "re:(?<![0-9a-f])[0-9a-f]{8}(?![0-9a-f])\n" }),
      ]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`commit ${sha.slice(0, 8)} limpio.txt:1 · patrón #1`);
    });
  });
});
