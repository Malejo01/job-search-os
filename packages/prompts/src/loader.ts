import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prompts versionados: `packages/prompts/<task>.v<N>.md` con frontmatter
 * (`version: <task>@v<N>`, `task`, `output`). Nunca inline en TS (CLAUDE.md).
 */
export type PromptRef = `${string}@v${number}` | `${string}@v${number}.${number}`; // acepta v1, v1.1, v1.3.1

export type Prompt = {
  version: PromptRef;
  task: string;
  output: string | null;
  template: string;
};

export type PromptError =
  | { kind: "not_found"; ref: string }
  | { kind: "bad_frontmatter"; ref: string; detail: string }
  | { kind: "missing_var"; ref: string; vars: string[] };

const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** "evaluate_job@v1" → "evaluate_job.v1.md" */
export function promptFileName(ref: string): string {
  const [task, version] = ref.split("@");
  return `${task}.${version}.md`;
}

/** Parsea `---\nkey: value\n---\nbody`. Solo pares planos; alcanza para los prompts. */
export function parseFrontmatter(
  source: string,
): { meta: Record<string, string>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2]!.replace(/^\r?\n/, "") };
}

export function loadPrompt(
  ref: PromptRef,
  dir: string = PROMPTS_DIR,
): { ok: true; value: Prompt } | { ok: false; error: PromptError } {
  let source: string;
  try {
    source = readFileSync(join(dir, promptFileName(ref)), "utf8");
  } catch {
    return { ok: false, error: { kind: "not_found", ref } };
  }
  const parsed = parseFrontmatter(source);
  if (!parsed) {
    return { ok: false, error: { kind: "bad_frontmatter", ref, detail: "sin frontmatter" } };
  }
  const { meta, body } = parsed;
  if (meta.version !== ref) {
    return {
      ok: false,
      error: {
        kind: "bad_frontmatter",
        ref,
        detail: `version del frontmatter (${meta.version ?? "?"}) no coincide con ${ref}`,
      },
    };
  }
  if (!meta.task) {
    return { ok: false, error: { kind: "bad_frontmatter", ref, detail: "falta task" } };
  }
  return {
    ok: true,
    value: { version: ref, task: meta.task, output: meta.output ?? null, template: body },
  };
}

/** Variables `{{nombre}}` que usa un template. */
export function templateVars(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** Interpola `{{var}}`. Falla si falta alguna variable: un prompt a medias no se manda. */
export function renderPrompt(
  prompt: Pick<Prompt, "template" | "version">,
  vars: Record<string, string | number | boolean>,
): { ok: true; value: string } | { ok: false; error: PromptError } {
  const missing = templateVars(prompt.template).filter((v) => !(v in vars));
  if (missing.length) {
    return { ok: false, error: { kind: "missing_var", ref: prompt.version, vars: missing } };
  }
  const text = prompt.template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) =>
    String(vars[name]),
  );
  return { ok: true, value: text };
}

/** Lista los prompts disponibles en el directorio (para CLI y evals). */
export function listPrompts(dir: string = PROMPTS_DIR): PromptRef[] {
  return readdirSync(dir)
    .filter((f) => /^[a-z0-9_]+\.v\d+(?:\.\d+)?\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, "").replace(/\.(v\d)/, "@$1") as PromptRef)
    .sort();
}
