// Barrido de privacidad para el repo PÚBLICO de Job Search OS (JS-063).
//
// Esta es la lógica versionada: no contiene patrones. Los lee de un directorio (por defecto
// fixtures-private/ en la raíz del repo), busca coincidencias SIN distinguir mayúsculas ni
// acentos y reporta archivo:línea y NÚMERO de patrón; nunca imprime el texto del patrón ni
// el de la coincidencia.
//
// Fuentes de patrones (dentro del directorio):
//   empresas.map.json     → todos los strings (claves y valores), salvo los alias "Empresa X"
//   privacy-patterns.txt  → uno por línea; "#" comenta; "re:" al inicio = regex sobre texto
//                           normalizado (minúsculas, sin acentos)
//   privacy-allow.txt     → términos a ignorar (falsos positivos)
//
// Sin patrones el barrido falla cerrado (código 2): sin ellos no se puede verificar nada.
//
// Modos:
//   (sin args)            rama actual vs main: diff, sin commitear, sin trackear,
//                         mensajes de commit y nombre de rama
//   --hook                igual, para el hook TaskCompleted (sale con 2 si hay hallazgos)
//   --pre-push            para .git/hooks/pre-push (lee refs por stdin)
//   --text-file <f>...    textos sueltos (título/cuerpo de PR)
//   --history <rango>     historia: "--all", "origin/main", "a..b", "refs/remotes/origin/pr/*"
//   --tree                todos los archivos versionados del HEAD (git ls-files)
//   --self-test           verifica carga y detección sin mostrar patrones
//   --explain <N>         muestra el patrón N (solo en una terminal propia)
//
// Opciones (en cualquier posición):
//   --patterns-dir <dir>  directorio de patrones (por defecto <root>/fixtures-private)
//   --root <dir>          repo a barrer (por defecto, el que contiene este script)

/* global console, process */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const BASE_CANDIDATES = ["origin/main", "main"];
const SKIP_FILES = [/(^|\/)pnpm-lock\.yaml$/, /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip)$/i];
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_PATHS = [
  { re: /^fixtures-private\//, why: "archivo de fixtures-private/" },
  { re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/, why: "archivo .env" },
];

export const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Carga los patrones de `dir`. Un directorio inexistente da una lista vacía (el CLI falla cerrado). */
export function loadPatterns(dir) {
  const pats = [];
  const allow = new Set();
  const allowFile = join(dir, "privacy-allow.txt");
  if (existsSync(allowFile)) {
    for (const l of readFileSync(allowFile, "utf8").split(/\r?\n/)) {
      if (l.trim() && !l.startsWith("#")) allow.add(norm(l.trim()));
    }
  }

  const add = (raw, source, isRegex = false) => {
    const text = raw.trim();
    if (!text) return;
    if (!isRegex) {
      const n = norm(text);
      if (n.length < 3 || allow.has(n) || /^empresa\s+[a-z]{1,2}$/.test(n)) return;
      if (pats.some((p) => !p.isRegex && p.n === n)) return;
      // Espacios flexibles: "Empresa Real" también matchea "empresa-real", "empresareal".
      const body = n.split(/\s+/).map(esc).join("[\\s._-]*");
      pats.push({
        id: pats.length + 1,
        source,
        n,
        isRegex,
        re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "u"),
      });
    } else {
      try {
        pats.push({ id: pats.length + 1, source, n: text, isRegex, re: new RegExp(text, "u") });
      } catch {
        console.error(
          `[privacy-scan] regex inválida en ${source} (se ignora el patrón #${pats.length + 1}).`,
        );
      }
    }
  };

  const mapFile = join(dir, "empresas.map.json");
  if (existsSync(mapFile)) {
    const walk = (v) => {
      if (typeof v === "string") add(v, "empresas.map.json");
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          add(k, "empresas.map.json");
          walk(val);
        }
      }
    };
    walk(JSON.parse(readFileSync(mapFile, "utf8")));
  }
  const patFile = join(dir, "privacy-patterns.txt");
  if (existsSync(patFile)) {
    for (const l of readFileSync(patFile, "utf8").split(/\r?\n/)) {
      if (!l.trim() || l.trim().startsWith("#")) continue;
      if (l.startsWith("re:")) add(l.slice(3), "privacy-patterns.txt", true);
      else add(l, "privacy-patterns.txt");
    }
  }
  return pats;
}

/** Números de los patrones que coinciden en una línea. */
export function scanLine(pats, line) {
  const n = norm(line);
  return pats.filter((p) => p.re.test(n)).map((p) => p.id);
}

/** Texto completo → hallazgos con número de línea. */
export function scanText(pats, label, text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const id of scanLine(pats, line)) hits.push({ where: `${label}:${i + 1}`, id });
  });
  return hits;
}

/** Diff unificado (-U0) → hallazgos en líneas agregadas, con número de línea nuevo. */
export function scanDiff(pats, diff, prefix = "") {
  const hits = [];
  const paths = [];
  let file = null;
  let ln = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      if (file === "/dev/null") file = null;
      else paths.push(file);
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      ln = Number(h[1]);
      continue;
    }
    if (!file || SKIP_FILES.some((re) => re.test(file))) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const id of scanLine(pats, line.slice(1))) {
        hits.push({ where: `${prefix}${file}:${ln}`, id });
      }
      ln++;
    }
  }
  return { hits, paths };
}

function pathHits(paths, prefix = "") {
  const out = [];
  for (const p of new Set(paths)) {
    for (const f of FORBIDDEN_PATHS) {
      if (f.re.test(p)) out.push({ where: `${prefix}${p}`, id: 0, why: f.why });
    }
  }
  return out;
}

function baseRef(root) {
  for (const b of BASE_CANDIDATES) {
    if (git(root, ["rev-parse", "--verify", "--quiet", b]).ok) return b;
  }
  return null;
}

/** Lee un archivo como texto; null si es muy grande, binario o ilegible. */
function readScannable(root, f) {
  if (SKIP_FILES.some((re) => re.test(f))) return null;
  try {
    const full = join(root, f);
    if (statSync(full).size > MAX_FILE_BYTES) return null;
    const buf = readFileSync(full);
    return buf.includes(0) ? null : buf.toString("utf8");
  } catch {
    return null;
  }
}

/** Historia: mensajes + líneas agregadas por commit. */
export function scanHistory(pats, revArgs, root = REPO_ROOT) {
  const SEP = "\x1e";
  const END = "\x1f";
  const r = git(root, [
    "log",
    "-p",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    `--format=${SEP}%H%n%B${END}`,
    ...revArgs,
  ]);
  if (!r.ok) throw new Error(`git log falló: ${r.err.trim()}`);
  const hits = [];
  let commits = 0;
  for (const chunk of r.out.split(SEP).slice(1)) {
    commits++;
    const sha = chunk.slice(0, 40);
    const endIdx = chunk.indexOf(END);
    const msg = chunk.slice(41, endIdx);
    const diff = chunk.slice(endIdx + 1);
    hits.push(...scanText(pats, `commit ${sha.slice(0, 8)} (mensaje)`, msg));
    const d = scanDiff(pats, diff, `commit ${sha.slice(0, 8)} `);
    hits.push(...d.hits, ...pathHits(d.paths, `commit ${sha.slice(0, 8)} `));
  }
  return { hits, commits };
}

/** Rama actual contra main + cambios sin commitear + archivos sin trackear. */
export function scanWorktree(pats, root = REPO_ROOT) {
  const hits = [];
  const base = baseRef(root);
  const branch = git(root, ["branch", "--show-current"]).out.trim();
  hits.push(...scanText(pats, "nombre de rama", branch));

  if (base) hits.push(...scanHistory(pats, [`${base}..HEAD`], root).hits);
  // Cambios sin commitear (staged + unstaged).
  const wd = git(root, ["diff", "HEAD", "-U0", "--no-color", "--no-ext-diff"]);
  const d = scanDiff(pats, wd.out, "sin commitear ");
  hits.push(...d.hits, ...pathHits(d.paths, "sin commitear "));
  // Archivos nuevos sin trackear (respetando .gitignore).
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"])
    .out.split(/\r?\n/)
    .filter(Boolean);
  hits.push(...pathHits(untracked, "sin trackear "));
  for (const f of untracked) {
    const text = readScannable(root, f);
    if (text !== null) hits.push(...scanText(pats, `sin trackear ${f}`, text));
  }
  return { hits, base };
}

/** Árbol: todos los archivos versionados (git ls-files), leídos del disco. */
export function scanTree(pats, root = REPO_ROOT) {
  const files = git(root, ["ls-files", "-z"]).out.split("\0").filter(Boolean);
  const hits = pathHits(files);
  for (const f of files) {
    const text = readScannable(root, f);
    if (text !== null) hits.push(...scanText(pats, f, text));
  }
  return { hits, files: files.length };
}

/** Informe sin texto de patrones ni de coincidencias: solo lugar y número. */
export function report(hits, pats) {
  const lines = hits.map((h) =>
    h.id === 0
      ? `  ${h.where} · ${h.why} (no puede publicarse)`
      : `  ${h.where} · patrón #${h.id} (${pats[h.id - 1].source})`,
  );
  const uniq = [...new Set(lines)];
  return `${uniq.length} hallazgo(s):\n${uniq.slice(0, 200).join("\n")}${uniq.length > 200 ? "\n  …" : ""}`;
}

function needPatterns(pats, dir) {
  if (pats.length > 0) return;
  console.error(
    `[privacy-scan] No hay patrones en ${dir}: falta empresas.map.json o privacy-patterns.txt.\n` +
      "Sin patrones no puedo verificar nada, así que fallo cerrado. Avisale a Mauro.",
  );
  process.exit(2);
}

/** Saca --root y --patterns-dir de los argumentos; el resto queda en `rest`. */
function parseArgs(argv) {
  const rest = [];
  let root = REPO_ROOT;
  let patternsDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" || argv[i] === "--patterns-dir") {
      if (!argv[i + 1]) return { usageError: `${argv[i]} necesita un valor.` };
      if (argv[i] === "--root") root = resolve(argv[++i]);
      else patternsDir = resolve(argv[++i]);
    } else rest.push(argv[i]);
  }
  return { root, patternsDir: patternsDir ?? join(root, "fixtures-private"), rest };
}

const USAGE =
  "Uso: privacy-scan.mjs [--root <dir>] [--patterns-dir <dir>] " +
  "(--tree | --hook | --pre-push | --text-file <f>... | --history <rango> | --self-test | --explain <N>)";

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.usageError) {
    console.error(`[privacy-scan] ${parsed.usageError}\n${USAGE}`);
    process.exit(1);
  }
  const { root, patternsDir, rest: args } = parsed;
  const mode = args[0] ?? "";
  let pats;
  try {
    pats = loadPatterns(patternsDir);
  } catch {
    // El mensaje de la excepción puede citar un fragmento del archivo (o sea, de un patrón).
    console.error(
      `[privacy-scan] No pude leer los patrones de ${patternsDir} (archivo ilegible o JSON inválido).\n` +
        "Sin patrones no puedo verificar nada, así que fallo cerrado. Avisale a Mauro.",
    );
    process.exit(2);
  }

  if (mode === "--explain") {
    if (process.env.CLAUDECODE || !process.stdout.isTTY || !process.stdin.isTTY) {
      console.error("--explain solo se usa en una terminal propia, fuera de Claude Code.");
      process.exit(1);
    }
    const p = pats[Number(args[1]) - 1];
    console.log(
      p ? `#${p.id} (${p.source}${p.isRegex ? ", regex" : ""}): ${p.n}` : "No existe ese número.",
    );
    return;
  }

  needPatterns(pats, patternsDir);

  if (mode === "--self-test") {
    const lit = pats.find((p) => !p.isRegex);
    const fails = [];
    if (lit) {
      const sample = lit.n.toUpperCase();
      if (!scanLine(pats, `texto de prueba ${sample} más texto`).includes(lit.id))
        fails.push("no detecta en MAYÚSCULAS");
      if (!scanLine(pats, `x "${lit.n}" y`).includes(lit.id))
        fails.push("no detecta entre comillas");
      if (scanLine(pats, `zz${lit.n.replace(/\s+/g, "")}zz`).includes(lit.id))
        fails.push("matchea dentro de otra palabra");
    }
    const bySource = pats.reduce((a, p) => ((a[p.source] = (a[p.source] ?? 0) + 1), a), {});
    const detail = Object.entries(bySource)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    console.log(`Patrones: ${pats.length} (${detail})`);
    console.log(
      fails.length ? `FALLA: ${fails.join("; ")}` : "Self-test OK (sin mostrar patrones).",
    );
    process.exit(fails.length ? 1 : 0);
  }

  if (mode === "--text-file") {
    const hits = [];
    for (const f of args.slice(1)) {
      hits.push(...scanText(pats, `texto ${f}`, readFileSync(f, "utf8")));
    }
    if (hits.length) {
      console.error(report(hits, pats));
      process.exit(1);
    }
    console.log("Sin hallazgos.");
    return;
  }

  if (mode === "--history") {
    const rev = args.slice(1);
    if (rev.length === 0) {
      console.error(
        'Uso: --history <rango> (ej.: --all, origin/main, "--glob=refs/remotes/origin/pr/*")',
      );
      process.exit(1);
    }
    const { hits, commits } = scanHistory(pats, rev, root);
    console.log(`Commits revisados: ${commits}`);
    if (hits.length) {
      console.error(report(hits, pats));
      process.exit(1);
    }
    console.log("Sin hallazgos.");
    return;
  }

  if (mode === "--tree") {
    const { hits, files } = scanTree(pats, root);
    console.log(`Archivos versionados revisados: ${files}`);
    if (hits.length) {
      console.error(report(hits, pats));
      process.exit(1);
    }
    console.log("Sin hallazgos.");
    return;
  }

  if (mode === "--pre-push") {
    const stdin = readFileSync(0, "utf8");
    const hits = [];
    for (const line of stdin.split(/\r?\n/).filter(Boolean)) {
      const [, localSha, remoteRef, remoteSha] = line.split(" ");
      if (/^0+$/.test(localSha)) continue; // borrado de rama: lo bloquea el guard
      hits.push(...scanText(pats, `rama remota ${remoteRef}`, remoteRef));
      const range = /^0+$/.test(remoteSha)
        ? [localSha, "--not", "--remotes=origin"]
        : [`${remoteSha}..${localSha}`];
      hits.push(...scanHistory(pats, range, root).hits);
    }
    if (hits.length) {
      console.error(
        `[pre-push] Push frenado por privacidad. ${report(hits, pats)}\n` +
          "Arreglá con alias y rehacé los commits afectados.",
      );
      process.exit(1);
    }
    return;
  }

  // Modo por defecto y --hook
  const isHook = mode === "--hook";
  let hookInput = {};
  if (isHook) {
    try {
      hookInput = JSON.parse(readFileSync(0, "utf8") || "{}");
    } catch {
      // sin JSON en stdin: se informa sin nombre de teammate ni de tarea
    }
  }
  const { hits, base } = scanWorktree(pats, root);
  if (!base) {
    console.error(
      "[privacy-scan] Aviso: no encontré main ni origin/main; revisé solo lo no commiteado.",
    );
  }
  if (hits.length === 0) {
    if (!isHook) console.log("Sin hallazgos.");
    process.exit(0);
  }
  const who = hookInput.teammate_name ? ` (${hookInput.teammate_name})` : "";
  const task = hookInput.task_subject ? `"${hookInput.task_subject}"` : "esta tarea";
  console.error(
    (isHook
      ? `No se puede cerrar ${task}${who}: hay datos privados en lo que se publicaría.\n`
      : "") +
      report(hits, pats) +
      "\nReemplazá por alias (Empresa A…) o mové el dato a ops/. " +
      "Si está en un commit, avisá al lead: hay que rehacer la rama.",
  );
  process.exit(isHook ? 2 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
