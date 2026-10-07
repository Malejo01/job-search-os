import { err, ok, type Result } from "../result";

/**
 * Parser determinista de formularios de postulación (JS-053, fase 2). Puro: sin I/O ni fecha.
 * Entrada: texto plano o HTML pegado. Falla cerrado: si no reconoce la estructura devuelve
 * `no_reconocido` y la UI pide pegar el formulario por partes. Nunca inventa preguntas ni
 * completa campos: lo que no tiene etiqueta o texto de pregunta se omite.
 */
export type FormQuestionKind = "texto" | "opcion" | "numero";

export type FormQuestion = {
  id: string;
  label: string;
  kind: FormQuestionKind;
  options?: string[];
  required: boolean;
};

export type ParsedForm = { questions: FormQuestion[] };
export type FormParseError = { reason: "no_reconocido" };

/** Tope de entrada: un formulario real no pasa de unos KB; más que esto no se analiza. */
const MAX_INPUT_CHARS = 50_000;
const NOT_RECOGNIZED = err<FormParseError>({ reason: "no_reconocido" });

const HTML_FORM_TAG = /<\s*(label|input|select|textarea)\b/i;

/** ¿El pegado trae etiquetas de formulario? Decide si la UI muestra la vista previa en iframe. */
export function looksLikeHtml(input: string): boolean {
  return HTML_FORM_TAG.test(input);
}

export function parseApplicationForm(input: string): Result<ParsedForm, FormParseError> {
  const text = input.trim();
  if (!text || text.length > MAX_INPUT_CHARS) return NOT_RECOGNIZED;
  const questions = looksLikeHtml(text) ? parseHtml(text) : parsePlain(text);
  if (questions.length === 0) return NOT_RECOGNIZED;
  return ok({ questions: questions.map((q, i) => ({ ...q, id: `q${i + 1}` })) });
}

type Draft = Omit<FormQuestion, "id">;

// ---------------------------------------------------------------- HTML

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith("#")) {
      const code =
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string) => decode(s).replace(/\s+/g, " ").trim();

/** Saca la marca de obligatorio de la etiqueta. */
function splitRequired(label: string): { label: string; required: boolean } {
  let s = label;
  let required = false;
  for (;;) {
    const next = s.replace(/\s*(\*|\((?:obligatori[oa]|requerid[oa]|required)\))$/i, "").trim();
    if (next === s) break;
    required = true;
    s = next;
  }
  return { label: s, required };
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const m of raw.matchAll(re)) {
    const name = m[1]!.toLowerCase();
    if (!(name in out)) out[name] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

type LabelNode = { for: string | null; parts: string[]; fields: number[] };
type FieldNode = {
  tag: "input" | "select" | "textarea";
  type: string;
  id: string | null;
  name: string | null;
  aria: string | null;
  placeholder: string | null;
  required: boolean;
  wrap: number | null;
  preceding: number | null;
  options: { value: string | null; text: string; disabled: boolean }[];
};

const SKIP_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "image",
  "file",
  "password",
]);

function parseHtml(html: string): Draft[] {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    // un script o style sin cierre se descarta hasta el final
    .replace(/<(script|style)\b[\s\S]*$/i, " ");

  const labels: LabelNode[] = [];
  const fields: FieldNode[] = [];
  let openLabel: number | null = null;
  let lastClosed: number | null = null;
  let select: FieldNode | null = null;
  let option: FieldNode["options"][number] | null = null;
  let inTextarea = false;

  const tokens = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/g;
  for (const m of source.matchAll(tokens)) {
    const [, slash, rawName, rawAttrs, textNode] = m;
    if (textNode !== undefined) {
      if (option) option.text += textNode;
      else if (!select && !inTextarea && openLabel !== null)
        labels[openLabel]!.parts.push(textNode);
      continue;
    }
    const name = rawName!.toLowerCase();
    const closing = slash === "/";
    if (name === "label" || name === "legend") {
      if (closing) {
        if (openLabel !== null) lastClosed = openLabel;
        openLabel = null;
      } else {
        labels.push({
          for: name === "label" ? (parseAttrs(rawAttrs ?? "")["for"] ?? null) : null,
          parts: [],
          fields: [],
        });
        openLabel = labels.length - 1;
      }
    } else if (name === "textarea") {
      if (closing) inTextarea = false;
      else {
        fields.push(newField("textarea", parseAttrs(rawAttrs ?? ""), openLabel, lastClosed));
        labels[openLabel ?? -1]?.fields.push(fields.length - 1);
        inTextarea = true;
      }
    } else if (name === "select") {
      if (closing) {
        select = null;
        option = null;
      } else {
        select = newField("select", parseAttrs(rawAttrs ?? ""), openLabel, lastClosed);
        fields.push(select);
        labels[openLabel ?? -1]?.fields.push(fields.length - 1);
      }
    } else if (name === "option") {
      if (closing) option = null;
      else if (select) {
        const a = parseAttrs(rawAttrs ?? "");
        option = { value: a["value"] ?? null, text: "", disabled: "disabled" in a };
        select.options.push(option);
      }
    } else if (name === "input" && !closing) {
      const a = parseAttrs(rawAttrs ?? "");
      const type = (a["type"] ?? "text").toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) continue;
      fields.push(newField("input", a, openLabel, lastClosed));
      labels[openLabel ?? -1]?.fields.push(fields.length - 1);
    } else if (option) {
      option = null; // otra etiqueta dentro de un option: el texto ya recolectado alcanza
    }
  }

  return resolveFields(labels, fields);
}

function newField(
  tag: FieldNode["tag"],
  a: Record<string, string>,
  wrap: number | null,
  preceding: number | null,
): FieldNode {
  return {
    tag,
    type: tag === "input" ? (a["type"] ?? "text").toLowerCase() : tag,
    id: a["id"] || null,
    name: a["name"] || null,
    aria: a["aria-label"] ? clean(a["aria-label"]) : null,
    placeholder: a["placeholder"] ? clean(a["placeholder"]) : null,
    required: "required" in a || a["aria-required"] === "true",
    wrap,
    preceding,
    options: [],
  };
}

function resolveFields(labels: LabelNode[], fields: FieldNode[]): Draft[] {
  const labelText = (i: number) => clean(labels[i]!.parts.join(" "));
  const byFor = new Map<string, number>();
  labels.forEach((l, i) => {
    if (l.for && !byFor.has(l.for)) byFor.set(l.for, i);
  });
  // Etiqueta propia del campo: label[for], label envolvente.
  const own = (f: FieldNode): number | null => {
    if (f.id && byFor.has(f.id)) return byFor.get(f.id)!;
    return f.wrap;
  };
  const bound = new Set<number>();
  for (const f of fields) {
    const o = own(f);
    if (o !== null) bound.add(o);
  }
  const consumed = new Set<number>();
  const freeBefore = (f: FieldNode): string | null => {
    const p = f.preceding;
    if (p === null || bound.has(p) || consumed.has(p)) return null;
    const t = labelText(p);
    if (!t) return null;
    consumed.add(p);
    return t;
  };

  const isGroupable = (f: FieldNode) => f.type === "radio" || f.type === "checkbox";
  const groupSize = new Map<string, number>();
  for (const f of fields) {
    if (isGroupable(f) && f.name) {
      const k = `${f.type}:${f.name}`;
      groupSize.set(k, (groupSize.get(k) ?? 0) + 1);
    }
  }

  const out: Draft[] = [];
  const groups = new Map<string, Draft>();
  for (const f of fields) {
    const o = own(f);
    const ownText = o !== null ? labelText(o) : "";

    if (isGroupable(f)) {
      const key = f.name ? `${f.type}:${f.name}` : null;
      if (key && (groupSize.get(key) ?? 0) > 1) {
        const optionText = ownText || f.aria || "";
        const existing = groups.get(key);
        if (existing) {
          if (optionText) existing.options!.push(optionText);
          existing.required ||= f.required;
          continue;
        }
        const q = f.aria ? null : freeBefore(f);
        const split = q ? splitRequired(q) : null;
        if (!split?.label) continue; // grupo sin texto de pregunta: no se inventa
        const draft: Draft = {
          label: split.label,
          kind: "opcion",
          options: optionText ? [optionText] : [],
          required: split.required || f.required,
        };
        groups.set(key, draft);
        out.push(draft);
        continue;
      }
      // radio o checkbox solo: la etiqueta propia es la pregunta
      const split = splitRequired(ownText || f.aria || "");
      if (!split.label) continue;
      out.push({ label: split.label, kind: "opcion", required: split.required || f.required });
      continue;
    }

    const raw = ownText || f.aria || freeBefore(f) || f.placeholder || "";
    const split = splitRequired(raw);
    if (!split.label) continue;
    const required = split.required || f.required;

    if (f.tag === "select") {
      const options = f.options
        .filter((op) => !(op.disabled && !op.value) && (op.value ?? op.text.trim()) !== "")
        .map((op) => clean(op.text))
        .filter(Boolean);
      out.push({ label: split.label, kind: "opcion", options, required });
    } else {
      out.push({
        label: split.label,
        kind: f.type === "number" || f.type === "range" ? "numero" : "texto",
        required,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- texto plano

const NUMBERED = /^\s*(?:\d{1,3}\s*[.)]|\(\d{1,3}\))\s+/;
const BULLET = /^\s*(?:[-•–·*]|\(\s*\)|\[\s*[xX]?\s*\]|☐|o)\s+/;
const NUMERIC_LABEL = /^\W*(años|cantidad de|cu[aá]nt[oa]s|how many|years)\b/i;

function parsePlain(text: string): Draft[] {
  const out: Draft[] = [];
  let current: Draft | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (current && BULLET.test(line) && !NUMBERED.test(line) && !line.endsWith("?")) {
      const option = line.replace(BULLET, "").trim();
      if (option) {
        current.options = [...(current.options ?? []), option];
        current.kind = "opcion";
      }
      continue;
    }

    const candidate = asQuestion(line.replace(NUMBERED, "").replace(BULLET, ""));
    if (candidate) {
      out.push(candidate);
      current = candidate;
    } else {
      current = null;
    }
  }
  return out;
}

/** Una línea es pregunta si termina en "?", en línea de respuesta (____) o lleva una marca explícita. */
function asQuestion(line: string): Draft | null {
  let s = line.trim();
  let required = false;
  let numeric = false;
  let marked = false;
  for (;;) {
    let next = s.replace(/\s*\*$/, "");
    if (next !== s) required = true;
    else {
      next = s.replace(/\s*\((?:obligatori[oa]|requerid[oa]|required)\)$/i, "");
      if (next !== s) required = true;
      else {
        next = s.replace(/\s*\((?:n[uú]mero|number|numeric)\)$/i, "");
        if (next !== s) numeric = true;
        else {
          next = s.replace(/\s*(?:_{2,}|…)$/, "");
          if (next !== s) marked = true;
        }
      }
    }
    if (next === s) break;
    s = next.trim();
  }
  if (!s || !(s.endsWith("?") || required || numeric || marked)) return null;
  return {
    label: s,
    kind: numeric || NUMERIC_LABEL.test(s) ? "numero" : "texto",
    required,
  };
}
