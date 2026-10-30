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
// Falla cerrado también con lo que no puede revisar (N4-1): un archivo ilegible, binario sin
// extensión conocida o de más de 2 MB, un diff o una historia de git que no se pueden parsear
// son hallazgos con id 0 («falla cerrado»), no se saltean. Si un comando de git falla (p. ej.
// --root no es un repo) el barrido se corta con código 2, también en --hook, donde 2 es el
// código que bloquea (1 no bloquea). El mensaje de error nunca cita texto de archivos.
//
// La historia se lee con `git log --remerge-diff` para revisar también lo que entra en un merge
// (resoluciones de conflicto, archivos agregados en el merge): necesita git >= 2.36. Con uno más
// viejo `git log` falla y el barrido sale con 2 (falla cerrado). Las opciones de diff que la
// config del usuario podría cambiar (prefijos, textconv, renombres, commit raíz, replace) se
// fijan en cada llamada.
//
// Nombres de archivo y ubicaciones también se revisan contra los patrones: un nombre con un dato
// privado es un hallazgo, y el informe y los errores no lo citan (lo reemplazan por
// «ubicación con dato privado (n.º K)» o «detalle omitido»).
//
// Códigos de salida: 0 sin hallazgos · 1 hallazgos (en --hook, 2) · 2 no se pudo verificar
// (sin patrones, regex inválida, error de git/lectura, entrada de pre-push inválida, --history
// con --all/--glob/--remotes/--branches/--tags que no revisó ningún commit) · 1 error de uso.
//
// Modos:
//   (sin args)            rama actual vs main: diff, sin commitear, sin trackear,
//                         mensajes de commit y nombre de rama. Sin main ni origin/main,
//                         revisa los commits de HEAD que no están en ningún remoto
//   --hook                igual, para el hook TaskCompleted (sale con 2 si hay hallazgos)
//   --pre-push            para .git/hooks/pre-push (lee refs por stdin); al pasar imprime
//                         "pre-push: OK (N commits)"
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
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
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

/**
 * Error propio del barrido. `message` cita comandos, rutas o revs (nunca texto de archivos); igual
 * se revisa contra los patrones antes de imprimirlo. `cmd`/`status` permiten un mensaje sin detalle.
 */
class ScanError extends Error {
  constructor(message, { cmd = null, status = null } = {}) {
    super(message);
    this.cmd = cmd;
    this.status = status;
  }
}

/** Regex inválida en los patrones: el mensaje no cita la regex. */
class PatternError extends Error {}

// Opciones globales: sin objetos de reemplazo (refs/replace) y rutas sin comillas ni octales.
const GIT_GLOBAL = ["--no-replace-objects", "-c", "core.quotePath=false"];
// Opciones de diff que la config del usuario podría cambiar y alterarían lo que se revisa.
const DIFF_OPTS = [
  "-U0",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];
const MAX_BUFFER = 256 * 1024 * 1024;

function git(root, args) {
  const r = spawnSync("git", [...GIT_GLOBAL, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  // Con ENOBUFS u otro error de spawn, stderr viene vacío y el motivo está en r.error.
  return {
    ok: r.status === 0,
    status: r.status,
    out: r.stdout ?? "",
    err: r.stderr || r.error?.message || "",
  };
}

/** Como git(), pero si el comando falla lanza: no hay salida parcial que revisar a medias. */
function gitOrThrow(root, args) {
  const r = git(root, args);
  if (!r.ok) {
    throw new ScanError(`git ${args[0]} falló (código ${r.status}): ${r.err.trim()}`, {
      cmd: args[0],
      status: r.status,
    });
  }
  return r.out;
}

/** Contenido de `f` en el índice (stage 0), como Buffer; null si no se pudo. */
function indexBlob(root, f) {
  const r = spawnSync("git", [...GIT_GLOBAL, "cat-file", "blob", `:${f}`], {
    cwd: root,
    maxBuffer: MAX_BUFFER,
  });
  return r.status === 0 && r.stdout ? r.stdout : null;
}

/** Hallazgo de algo que no se pudo revisar: bloquea igual que una coincidencia. */
const unchecked = (where, why) => ({ where, id: 0, why: `${why}, falla cerrado` });
const skipped = (f) => SKIP_FILES.some((re) => re.test(f));

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
      let re;
      try {
        re = new RegExp(text, "u");
      } catch {
        // Ignorarla dejaría de buscar ese dato: falla cerrado, sin citar la regex.
        throw new PatternError(`regex inválida en ${source} (patrón #${pats.length + 1})`);
      }
      pats.push({ id: pats.length + 1, source, n: text, isRegex, re });
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

/** Ruta nueva de una línea `diff --git a/x b/y` (aproximada si hay espacios o comillas). */
function diffGitPath(line) {
  const rest = line.slice("diff --git ".length);
  const quoted = rest.lastIndexOf(' "b/');
  if (rest.endsWith('"') && quoted >= 0) return rest.slice(quoted + 4, -1);
  const i = rest.lastIndexOf(" b/");
  return i >= 0 ? rest.slice(i + 3) : null;
}

/**
 * Diff unificado → hallazgos en líneas agregadas, con número de línea nuevo.
 *
 * Con estado: `diff --git` abre la cabecera de un archivo; `---`/`+++` solo son cabecera fuera
 * de un hunk; dentro de un hunk, los contadores de `@@ -a,b +c,d @@` dicen cuántas líneas
 * quedan, así que una línea agregada que empieza con «++ » es contenido. Sin `diff --git`
 * (diffs sueltos) una línea `+++ ` fuera de un hunk sigue siendo cabecera. Lo que no encaja
 * (hunk cortado, línea agregada fuera de un hunk, binario sin extensión conocida) es hallazgo
 * con id 0: no se saltea.
 */
export function scanDiff(pats, diff, prefix = "") {
  const hits = [];
  const paths = [];
  const addPath = (p) => {
    if (p && p !== "/dev/null" && !paths.includes(p)) paths.push(p);
  };
  let file = null;
  // Ruta de `diff --git`: queda pendiente hasta cerrar el bloque y se descarta si es un borrado
  // (borrar o renombrar a alias una ruta con un dato privado es justamente el arreglo).
  let pending = null;
  const flush = () => {
    if (pending) addPath(pending);
    pending = null;
  };
  let ln = 0;
  let oldLeft = 0;
  let newLeft = 0;
  const here = () => `${prefix}${file ?? "(archivo desconocido)"}`;
  const malformed = (why) => hits.push(unchecked(here(), why));

  for (const line of diff.split(/\r?\n/)) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === "+" || c === " ") {
        if (newLeft === 0 || (c === " " && oldLeft === 0)) {
          malformed("diff con más líneas que las del hunk");
        }
        if (c === " ") oldLeft = Math.max(0, oldLeft - 1);
        else if (!file) malformed("línea agregada sin archivo");
        else if (!skipped(file)) {
          for (const id of scanLine(pats, line.slice(1))) {
            hits.push({ where: `${prefix}${file}:${ln}`, id });
          }
        }
        newLeft = Math.max(0, newLeft - 1);
        ln++;
        continue;
      }
      if (c === "-") {
        if (oldLeft === 0) malformed("diff con más líneas que las del hunk");
        oldLeft = Math.max(0, oldLeft - 1);
        continue;
      }
      if (c === "\\") continue; // «\ No newline at end of file»
      // Una línea que no es de hunk antes de completar los contadores: el hunk quedó cortado.
      // Se marca y la línea se procesa como cabecera.
      malformed("hunk de diff incompleto");
      oldLeft = newLeft = 0;
    }
    // Fuera de un hunk: cabeceras.
    if (line.startsWith("diff --git ")) {
      flush();
      file = pending = diffGitPath(line);
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      file = pending = null;
      continue;
    }
    // Sin --no-renames (diffs sueltos), la ruta nueva de un renombre o copia viene acá.
    const rc = line.match(/^(?:rename|copy) to (.+)$/);
    if (rc) {
      pending = null;
      file = rc[1];
      addPath(file);
      continue;
    }
    if (line.startsWith("+++ ")) {
      // git agrega un tab al final si la ruta tiene espacios.
      file = line.slice(4).replace(/\t$/, "").replace(/^b\//, "");
      if (file === "/dev/null") file = null;
      pending = null;
      addPath(file);
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      oldLeft = h[1] === undefined ? 1 : Number(h[1]);
      newLeft = h[3] === undefined ? 1 : Number(h[3]);
      ln = Number(h[2]);
      continue;
    }
    if (/^Binary files .* differ$/.test(line) || line === "GIT binary patch") {
      if (line.endsWith(" and /dev/null differ")) pending = null;
      else if (file && !skipped(file)) {
        malformed("binario sin extensión conocida");
      }
      continue;
    }
    if (line.startsWith("+")) malformed("línea agregada fuera de un hunk");
    // El resto (---, index, new file mode, rename, líneas en blanco, «-» sueltas) no agrega texto.
  }
  if (oldLeft > 0 || newLeft > 0) malformed("hunk de diff incompleto");
  flush();
  return { hits, paths };
}

/** Rutas prohibidas (id 0) y rutas cuyo nombre coincide con un patrón (id del patrón). */
function pathHits(pats, paths, prefix = "") {
  const out = [];
  for (const p of new Set(paths)) {
    for (const f of FORBIDDEN_PATHS) {
      if (f.re.test(p)) out.push({ where: `${prefix}${p}`, id: 0, why: f.why });
    }
    for (const id of scanLine(pats, p)) out.push({ where: `${prefix}${p}`, id });
  }
  return out;
}

function baseRef(root) {
  for (const b of BASE_CANDIDATES) {
    if (git(root, ["rev-parse", "--verify", "--quiet", b]).ok) return b;
  }
  return null;
}

/** Buffer → texto, o el motivo por el que no se revisa. */
function bufText(buf) {
  if (buf.length > MAX_FILE_BYTES) return { why: "demasiado grande para revisar" };
  if (buf.includes(0)) return { why: "binario sin extensión conocida" };
  return { text: buf.toString("utf8") };
}

/**
 * Lee lo que se publicaría de `f`: `{ text }`; `{ skip: true }` si está en SKIP_FILES o es un
 * directorio (submódulo, repo anidado: su ruta ya pasó por pathHits); `{ why }` si no se pudo
 * revisar, que es un hallazgo y no se saltea.
 *
 * Un symlink se revisa por su destino (eso es lo que git guarda), aunque esté roto. Con
 * `fromIndex`, un archivo versionado que no está en el disco se lee del índice.
 */
function readScannable(root, f, { fromIndex = false } = {}) {
  if (skipped(f)) return { skip: true };
  const full = join(root, f);
  let st;
  try {
    st = lstatSync(full);
  } catch (err) {
    if (fromIndex && err?.code === "ENOENT") {
      const blob = indexBlob(root, f);
      return blob ? bufText(blob) : { why: "versionado pero ausente del disco y del índice" };
    }
    return { why: "no se pudo leer" };
  }
  try {
    if (st.isSymbolicLink()) return { text: readlinkSync(full, "utf8") };
    if (st.isDirectory()) return { skip: true };
    if (!st.isFile()) return { why: "no es un archivo regular" };
    if (st.size > MAX_FILE_BYTES) return { why: "demasiado grande para revisar" };
    return bufText(readFileSync(full));
  } catch {
    return { why: "no se pudo leer" };
  }
}

/** Revisa un archivo del disco: coincidencias por línea o un hallazgo id 0 si no se pudo. */
function scanFile(pats, root, f, label, opts) {
  const r = readScannable(root, f, opts);
  if (r.why) return [unchecked(label, r.why)];
  return r.text === undefined ? [] : scanText(pats, label, r.text);
}

/**
 * Historia: mensajes + líneas agregadas por commit.
 *
 * Los separadores llevan un nonce aleatorio por corrida, así que ni un mensaje ni una línea de
 * un archivo pueden imitarlos. Igual se valida: cada bloque empieza con un sha + salto de línea
 * y tiene el fin de mensaje, y la cantidad de bloques coincide con `git rev-list --count` sobre
 * los mismos argumentos. Si algo no cuadra, hallazgo id 0: la historia no se revisó entera.
 */
export function scanHistory(pats, revArgs, root = REPO_ROOT) {
  const nonce = randomBytes(16).toString("hex");
  const SEP = `\x1e<privacy-scan ${nonce}>`;
  const END = `\x1f<privacy-scan ${nonce}>`;
  const out = gitOrThrow(root, [
    "log",
    "-p",
    ...DIFF_OPTS,
    // Diff de los merges contra la fusión automática: resoluciones y archivos nuevos del merge.
    "--remerge-diff",
    // El commit raíz con su diff aunque log.showRoot=false.
    "--root",
    "--no-show-signature",
    `--format=${SEP}%H%n%P%n%B${END}`,
    ...revArgs,
  ]);
  const expected = Number(gitOrThrow(root, ["rev-list", "--count", ...revArgs]).trim());

  const hits = [];
  let parsedOk = true;
  const parts = out.split(SEP);
  if (parts[0] !== "") parsedOk = false;
  const chunks = parts.slice(1);
  if (!Number.isInteger(expected) || chunks.length !== expected) parsedOk = false;
  let commits = 0;
  // Cabecera de cada bloque: sha, salto de línea, padres (vacío en el commit raíz), salto.
  const HEAD_RE = /^([0-9a-f]{40})\n((?:[0-9a-f]{40}(?: [0-9a-f]{40})*)?)\n/;
  for (const chunk of chunks) {
    const endIdx = chunk.indexOf(END);
    const head = chunk.match(HEAD_RE);
    if (!head || endIdx < head[0].length) {
      parsedOk = false;
      continue;
    }
    commits++;
    const sha8 = head[1].slice(0, 8);
    const where = `commit ${sha8} `;
    // --remerge-diff no cubre merges octopus: lo que traen no se puede revisar.
    if (head[2].split(" ").length > 2) {
      hits.push(unchecked(`commit ${sha8}`, "merge con más de dos padres: no se puede revisar"));
    }
    const msg = chunk.slice(head[0].length, endIdx);
    const diff = chunk.slice(endIdx + END.length);
    hits.push(...scanText(pats, `${where}(mensaje)`, msg));
    const d = scanDiff(pats, diff, where);
    hits.push(...d.hits, ...pathHits(pats, d.paths, where));
  }
  if (!parsedOk) hits.push(unchecked("historia de git", "no se pudo parsear la historia de git"));
  return { hits, commits };
}

/**
 * Rama actual contra main + cambios sin commitear + archivos sin trackear. Sin main ni
 * origin/main, los commits de HEAD que no están en ningún remoto (base null).
 */
export function scanWorktree(pats, root = REPO_ROOT) {
  const hits = [];
  const base = baseRef(root);
  const branch = gitOrThrow(root, ["branch", "--show-current"]).trim();
  hits.push(...scanText(pats, "nombre de rama", branch));

  const range = base ? [`${base}..HEAD`] : ["HEAD", "--not", "--remotes"];
  hits.push(...scanHistory(pats, range, root).hits);
  // Cambios sin commitear (staged + unstaged).
  const wd = gitOrThrow(root, ["diff", "HEAD", ...DIFF_OPTS]);
  const d = scanDiff(pats, wd, "sin commitear ");
  hits.push(...d.hits, ...pathHits(pats, d.paths, "sin commitear "));
  // Archivos nuevos sin trackear (respetando .gitignore).
  const untracked = gitOrThrow(root, ["ls-files", "-z", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean);
  hits.push(...pathHits(pats, untracked, "sin trackear "));
  for (const f of untracked) hits.push(...scanFile(pats, root, f, `sin trackear ${f}`));
  return { hits, base };
}

/** Árbol: todos los archivos versionados (git ls-files), leídos del disco. */
export function scanTree(pats, root = REPO_ROOT) {
  const files = gitOrThrow(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const hits = pathHits(pats, files);
  for (const f of files) hits.push(...scanFile(pats, root, f, f, { fromIndex: true }));
  return { hits, files: files.length };
}

/**
 * Informe sin texto de patrones ni de coincidencias: solo lugar y número. Los id 0 son rutas
 * prohibidas o cosas que no se pudieron revisar (falla cerrado); ambos bloquean.
 */
export function report(hits, pats) {
  // Una ubicación que coincide con un patrón (nombre de archivo, de rama...) no se cita: se
  // numera, con el mismo número para la misma ubicación.
  // Solo se mira la ruta o etiqueta: el prefijo (commit <sha>, sin trackear...) y el número de
  // línea se conservan, y una regex de dígitos o hex no oculta ubicaciones por el sha.
  const hidden = new Map();
  const place = (where) => {
    const m = where.match(
      /^((?:commit [0-9a-f]{8}|sin commitear|sin trackear|texto)(?: |$))?([\s\S]*?)(:\d+)?$/,
    );
    const [, pre = "", path = "", line = ""] = m ?? [];
    if (!path || scanLine(pats, path).length === 0) return where;
    if (!hidden.has(path)) hidden.set(path, hidden.size + 1);
    return `${pre}ubicación con dato privado (n.º ${hidden.get(path)})${line}`;
  };
  const lines = hits.map((h) =>
    h.id === 0
      ? `  ${place(h.where)} · ${h.why} (no puede publicarse)`
      : `  ${place(h.where)} · patrón #${h.id} (${pats[h.id - 1].source})`,
  );
  const uniq = [...new Set(lines)];
  return `${uniq.length} hallazgo(s):\n${uniq.slice(0, 200).join("\n")}${uniq.length > 200 ? "\n  …" : ""}`;
}

/**
 * Error al barrer (git falló, archivo de --text-file ilegible...): falla cerrado con 2, que es
 * lo que bloquea en --hook. Solo se imprime el mensaje de errores propios o del sistema (citan
 * comandos y rutas); de cualquier otro, solo el tipo, por si citara texto de un archivo.
 */
function failClosed(err, pats) {
  const safe =
    err instanceof ScanError || (err instanceof Error && "code" in err && "syscall" in err);
  let detail = safe ? err.message : (err?.name ?? "error desconocido");
  if (safe && err.message.split(/\r?\n/).some((l) => scanLine(pats, l).length > 0)) {
    detail =
      err instanceof ScanError && err.cmd
        ? `git ${err.cmd} falló (código ${err.status}; detalle omitido porque cita un dato privado)`
        : `${err.code ?? "error"} (detalle omitido porque cita un dato privado)`;
  }
  console.error(
    `[privacy-scan] No pude completar el barrido: ${detail}\n` +
      "No se puede verificar nada, así que fallo cerrado. Avisale a Mauro.",
  );
  process.exit(2);
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
  } catch (err) {
    // El mensaje de la excepción puede citar un fragmento del archivo (o sea, de un patrón).
    const what = err instanceof PatternError ? err.message : "archivo ilegible o JSON inválido";
    console.error(
      `[privacy-scan] No pude leer los patrones de ${patternsDir} (${what}).\n` +
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

  try {
    await runMode(mode, args, pats, root);
  } catch (err) {
    failClosed(err, pats);
  }
}

/** Modos que barren. Cualquier excepción la convierte main() en código 2 (falla cerrado). */
async function runMode(mode, args, pats, root) {
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
    if (args.length < 2) {
      console.error(`[privacy-scan] --text-file necesita al menos un archivo.\n${USAGE}`);
      process.exit(1);
    }
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
    // 0 commits con un patrón de refs que no resuelve ninguna ref (p. ej. sin fetch) es un
    // barrido que no corrió. Con refs que existen (p. ej. «--all --not --all»), 0 es válido.
    if (commits === 0) {
      for (const a of rev.filter((x) => /^--(all|glob|remotes|branches|tags)(=|$)/.test(x))) {
        if (!gitOrThrow(root, ["rev-parse", a]).trim()) {
          throw new ScanError(`no se revisó ningún commit: ${a} no resuelve ninguna ref`);
        }
      }
    }
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
    // Suma de commits revisados por ref (un commit compartido por dos refs cuenta dos veces).
    let commits = 0;
    const refs = stdin.split(/\r?\n/).filter(Boolean);
    for (const [i, line] of refs.entries()) {
      const [, localSha, remoteRef, remoteSha] = line.split(" ");
      // Solo shas a git: nada de texto arbitrario de stdin como argumento.
      const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
      if (!SHA.test(localSha ?? "") || !SHA.test(remoteSha ?? "") || remoteRef === undefined) {
        throw new ScanError(`línea ${i + 1} de pre-push con formato inesperado`);
      }
      if (/^0+$/.test(localSha)) continue; // borrado de rama: lo bloquea el guard
      // La etiqueta no lleva el nombre de la rama: si coincide con un patrón, el informe lo citaría.
      hits.push(...scanText(pats, `rama remota (ref ${i + 1} del push)`, remoteRef));
      const range = /^0+$/.test(remoteSha)
        ? [localSha, "--not", "--remotes=origin"]
        : [`${remoteSha}..${localSha}`];
      const scanned = scanHistory(pats, range, root);
      hits.push(...scanned.hits);
      commits += scanned.commits;
    }
    if (hits.length) {
      console.error(
        `[pre-push] Push frenado por privacidad. ${report(hits, pats)}\n` +
          "Arreglá con alias y rehacé los commits afectados.",
      );
      process.exit(1);
    }
    // Sin esto, "pasó" y "no corrió" se ven igual (JS-078). Un push que solo borra ramas da 0.
    console.log(`pre-push: OK (${commits} commits)`);
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
      "[privacy-scan] Aviso: no encontré main ni origin/main; revisé los commits de HEAD que " +
        "no están en ningún remoto, más lo no commiteado.",
    );
  }
  if (hits.length === 0) {
    if (!isHook) console.log("Sin hallazgos.");
    process.exit(0);
  }
  const mate = typeof hookInput.teammate_name === "string" ? hookInput.teammate_name : "";
  const who = mate && !scanLine(pats, mate).length ? ` (${mate})` : "";
  // Si el título de la tarea tiene un dato privado, no se cita.
  const subject = typeof hookInput.task_subject === "string" ? hookInput.task_subject : "";
  const task = subject && !scanLine(pats, subject).length ? `"${subject}"` : "esta tarea";
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

/** ¿Se corre este archivo como script? Compara rutas reales: puede invocarse por un symlink. */
function isMain() {
  if (!process.argv[1]) return false;
  let path = process.argv[1];
  try {
    path = realpathSync(path);
  } catch {
    // sin ruta real: se compara la ruta tal cual
  }
  return import.meta.url === pathToFileURL(path).href;
}

if (isMain()) await main();
