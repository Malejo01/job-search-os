import type { SkillTaxonomyEntry } from "./match";

/**
 * Skills propias (ronda 78): la persona agrega una skill que no está en la taxonomía. Se guarda en
 * `user_skills` con su nivel y se muestra en su pantalla. NO entra a la taxonomía global ni a ningún
 * prompt: el nombre es texto libre de la persona y se trata como dato, nunca como instrucción.
 * Puro: la web pasa la taxonomía y lo ya guardado.
 */
export const MAX_CUSTOM_SKILLS = 30;
export const CUSTOM_SKILL_MIN_LENGTH = 2;
export const CUSTOM_SKILL_MAX_LENGTH = 40;

export type CustomSkillRejection = "corto" | "largo" | "caracteres" | "url" | "en_taxonomia";

export type CustomSkillNameCheck =
  | { ok: true; name: string; key: string }
  | {
      ok: false;
      reason: CustomSkillRejection;
      /** Con `en_taxonomia`: la skill de la lista que hay que usar en su lugar. */
      existing?: { slug: string; name: string };
    };

/** Sin acentos, sin mayúsculas y con espacios colapsados: para comparar nombres. */
export function customSkillKey(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Controles y caracteres invisibles (ancho cero, direccionales), además de `<` y `>`. */
const BAD_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}<>]/u;
/** Esquema, `www.` o un dominio con extensión común. */
const URL_LIKE = /:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|io|dev|app|info|xyz)\b/i;

/** Términos con los que una skill de la taxonomía puede escribirse. */
function taxonomyTerms(entry: SkillTaxonomyEntry): string[] {
  const terms = new Set<string>([entry.slug.replace(/_/g, " "), entry.name, ...entry.aliases]);
  // "Redes (TCP/IP, DNS, VPN)" también se escribe "Redes"; "Git / GitHub", "Git" o "GitHub"
  const withoutParens = entry.name.replace(/\([^)]*\)/g, " ");
  terms.add(withoutParens);
  for (const part of withoutParens.split(" / ")) terms.add(part);
  return [...terms].map(customSkillKey).filter((t) => t.length > 0);
}

/**
 * Valida el nombre de una skill propia: de 2 a 40 caracteres (con `trim` y espacios colapsados), sin
 * caracteres de control ni `<` `>`, sin links y que no coincida (por nombre o alias) con una skill de
 * la taxonomía: en ese caso devuelve cuál usar.
 */
export function validateCustomSkillName(
  raw: string,
  taxonomy: readonly SkillTaxonomyEntry[],
): CustomSkillNameCheck {
  const trimmed = raw.trim();
  if (BAD_CHARS.test(trimmed)) return { ok: false, reason: "caracteres" };
  const name = trimmed.replace(/\s+/g, " ");
  if (name.length < CUSTOM_SKILL_MIN_LENGTH) return { ok: false, reason: "corto" };
  if (name.length > CUSTOM_SKILL_MAX_LENGTH) return { ok: false, reason: "largo" };
  if (URL_LIKE.test(name)) return { ok: false, reason: "url" };
  const key = customSkillKey(name);
  for (const entry of taxonomy) {
    if (taxonomyTerms(entry).includes(key)) {
      return {
        ok: false,
        reason: "en_taxonomia",
        existing: { slug: entry.slug, name: entry.name },
      };
    }
  }
  return { ok: true, name, key };
}

/** Texto para mostrar al lado del campo cuando el nombre no sirve. */
export function customSkillRejectionText(
  check: Extract<CustomSkillNameCheck, { ok: false }>,
): string {
  switch (check.reason) {
    case "corto":
      return `El nombre tiene que tener al menos ${CUSTOM_SKILL_MIN_LENGTH} letras.`;
    case "largo":
      return `El nombre puede tener hasta ${CUSTOM_SKILL_MAX_LENGTH} caracteres.`;
    case "caracteres":
      return "El nombre no puede tener símbolos < o >, ni caracteres de control.";
    case "url":
      return "Escribí solo el nombre de la skill, sin links.";
    case "en_taxonomia":
      return `«${check.existing?.name ?? "Esa skill"}» ya está en la lista: usá esa.`;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEW_KEY = /^[a-z0-9]{1,12}$/;
const LEVEL = /^[0-3]$/;

/** Ids de los botones «Quitar» de las skills propias (campo `quitar_propia`): sin repetidos y con formato de uuid. */
export function parseRemoveCustomIds(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of values) if (UUID.test(v)) out.add(v.toLowerCase());
  return [...out].slice(0, MAX_CUSTOM_SKILLS);
}

export type CustomSkillsParse =
  | {
      ok: true;
      /** Skills ya guardadas con otro nivel (el servidor filtra las que no son de la persona). */
      updates: { id: string; level: number }[];
      additions: { name: string; key: string; level: number }[];
    }
  | { ok: false; field: string };

/**
 * Lee las skills propias del formulario:
 * - `clevel:<id>`: nivel de una ya guardada ("" = sin cambio);
 * - `new_name:<k>` + `new_level:<k>`: una nueva, con su nivel obligatorio.
 * Si falla devuelve el campo (`new_name:<k>`, `new_level:<k>`, `clevel:<id>`, `custom_form` o
 * `custom_max`), nunca el valor. `existing` son las ya guardadas; `remove`, los ids que se quitan en
 * el mismo envío (liberan su cupo y su nombre).
 */
export function parseCustomSkillsForm(
  raw: Record<string, string | undefined>,
  ctx: {
    taxonomy: readonly SkillTaxonomyEntry[];
    existing: readonly { id: string; name: string }[];
    remove?: readonly string[];
  },
): CustomSkillsParse {
  const removed = new Set((ctx.remove ?? []).map((id) => id.toLowerCase()));
  const kept = ctx.existing.filter((e) => !removed.has(e.id.toLowerCase()));
  const knownIds = new Set(ctx.existing.map((e) => e.id.toLowerCase()));

  const updates: { id: string; level: number }[] = [];
  const additions: { name: string; key: string; level: number }[] = [];
  const keys = Object.keys(raw);
  // Tope de campos: evita recorrer un envío armado a mano
  if (keys.filter((k) => /^(clevel|new_name|new_level):/.test(k)).length > MAX_CUSTOM_SKILLS * 3) {
    return { ok: false, field: "custom_form" };
  }

  for (const key of keys) {
    if (!key.startsWith("clevel:")) continue;
    const id = key.slice("clevel:".length);
    if (!UUID.test(id)) return { ok: false, field: "custom_form" };
    const v = (raw[key] ?? "").trim();
    if (v === "") continue;
    if (!LEVEL.test(v)) return { ok: false, field: key };
    // Lo quitado o ajeno no se actualiza
    if (!knownIds.has(id.toLowerCase()) || removed.has(id.toLowerCase())) continue;
    updates.push({ id: id.toLowerCase(), level: Number(v) });
  }

  const taken = new Set(kept.map((e) => customSkillKey(e.name)));
  for (const key of keys) {
    if (!key.startsWith("new_name:")) continue;
    const k = key.slice("new_name:".length);
    if (!NEW_KEY.test(k)) return { ok: false, field: "custom_form" };
    const check = validateCustomSkillName(raw[key] ?? "", ctx.taxonomy);
    if (!check.ok || taken.has(check.key)) return { ok: false, field: key };
    const level = (raw[`new_level:${k}`] ?? "").trim();
    if (!LEVEL.test(level)) return { ok: false, field: `new_level:${k}` };
    if (kept.length + additions.length + 1 > MAX_CUSTOM_SKILLS) {
      return { ok: false, field: "custom_max" };
    }
    taken.add(check.key);
    additions.push({ name: check.name, key: check.key, level: Number(level) });
  }
  return { ok: true, updates, additions };
}
