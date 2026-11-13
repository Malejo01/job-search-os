import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPatterns, type Pattern } from "../../../../scripts/privacy-scan.mjs";
import { buildSkeletons, type SkeletonInput } from "./skeleton";

/**
 * pnpm --filter @job-search-os/adapters inbound:skeleton <carpeta-eml> <carpeta-salida>
 *   [--portal <dominio>]... [--patterns-dir <dir>] [--sin-plantilla]
 *
 * Convierte cada .eml de una carpeta en un esqueleto HTML sin datos personales (<n>.skeleton.html)
 * y un resumen.md, para escribir parsers mirando la estructura (R8-1). Lo corre Mauro: los agentes
 * no leen los .eml reales. Falla cerrado: sin patrones de privacidad no escribe nada (código 2);
 * un .eml cuya salida coincide con algún patrón no se escribe y se informa por número (código 1).
 * Nunca imprime nombres de archivo ni texto de los emails.
 *
 * Las rutas relativas se resuelven desde la raíz del repo. La salida solo puede ir fuera del repo
 * o dentro de ops/ (no versionado): así un esqueleto no termina en un commit por error.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAX_EML_BYTES = 8 * 1024 * 1024;

function fail(message: string, code: number): never {
  console.error(`inbound:skeleton: ${message}`);
  process.exit(code);
}

function parseArgs(argv: string[]): {
  input: string;
  output: string;
  portals: string[];
  patternsDir: string;
  keepTemplate: boolean;
} {
  const positional: string[] = [];
  const portals: string[] = [];
  let patternsDir = join(ROOT, "fixtures-private");
  let keepTemplate = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--portal" || a === "--patterns-dir") {
      const v = argv[++i];
      if (!v) fail(`${a} necesita un valor`, 1);
      if (a === "--portal") portals.push(v.toLowerCase());
      else patternsDir = resolve(ROOT, v);
    } else if (a === "--sin-plantilla") keepTemplate = false;
    else if (a.startsWith("--")) fail(`opción desconocida ${a}`, 1);
    else positional.push(a);
  }
  if (positional.length !== 2) {
    fail(
      "uso: inbound:skeleton <carpeta-eml> <carpeta-salida> [--portal <dominio>] [--patterns-dir <dir>] [--sin-plantilla]",
      1,
    );
  }
  return {
    input: resolve(ROOT, positional[0]!),
    output: resolve(ROOT, positional[1]!),
    portals,
    patternsDir,
    keepTemplate,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // La salida no puede quedar dentro del repo, salvo en ops/
  const rel = relative(ROOT, args.output);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !rel.includes(":"));
  if (insideRepo && rel.split(sep)[0] !== "ops") {
    fail("la carpeta de salida tiene que estar fuera del repo o dentro de ops/ (no versionado)", 1);
  }

  if (!existsSync(args.input) || !statSync(args.input).isDirectory()) {
    fail("la carpeta de entrada no existe", 1);
  }
  const files = readdirSync(args.input)
    .filter((f) => f.toLowerCase().endsWith(".eml"))
    .sort();
  if (files.length === 0) fail("no hay archivos .eml en la carpeta de entrada", 1);

  // Sin patrones no se puede verificar nada: no se escribe nada
  let patterns: Pattern[];
  try {
    patterns = loadPatterns(args.patternsDir);
  } catch {
    fail("no pude leer los patrones de privacidad; no se escribió nada", 2);
  }
  if (patterns.length === 0) {
    fail("no hay patrones de privacidad (--patterns-dir); sin ellos no se escribe nada", 2);
  }

  const inputs: SkeletonInput[] = [];
  const unreadable = new Set<number>();
  files.forEach((f, idx) => {
    const id = idx + 1;
    const full = join(args.input, f);
    try {
      if (statSync(full).size > MAX_EML_BYTES) throw new Error("grande");
      inputs.push({ id, raw: readFileSync(full).toString("latin1") });
    } catch {
      unreadable.add(id);
    }
  });

  const { results, resumen } = buildSkeletons(inputs, {
    patterns,
    portalDomains: args.portals,
    keepTemplateText: args.keepTemplate,
  });

  mkdirSync(args.output, { recursive: true });
  let written = 0;
  let blocked = unreadable.size;
  for (const r of results) {
    const target = join(args.output, `${r.id}.skeleton.html`);
    if (r.ok) {
      writeFileSync(target, r.html, "utf8");
      written++;
    } else {
      // Una corrida anterior pudo haber escrito este esqueleto: no puede quedar
      rmSync(target, { force: true });
      blocked++;
      console.error(`  eml ${r.id}: sin esqueleto (${r.reason})`);
    }
  }
  for (const id of unreadable) {
    rmSync(join(args.output, `${id}.skeleton.html`), { force: true });
    console.error(`  eml ${id}: sin esqueleto (no se pudo leer o es demasiado grande)`);
  }
  const extra = unreadable.size
    ? `\n\nNo se pudieron leer: ${[...unreadable].map((i) => `eml ${i}`).join(", ")}.\n`
    : "\n";
  writeFileSync(join(args.output, "resumen.md"), resumen + extra, "utf8");

  console.log(
    `esqueletos escritos: ${written} · bloqueados: ${blocked} · salida: ${args.output}\n` +
      "(los números son el orden alfabético de los .eml de la carpeta de entrada)",
  );
  if (blocked > 0) process.exitCode = 1;
}

main();
