import type { ChecklistItem } from "../evaluator/checklist";
import { englishRankFromCefr } from "../decide";

/**
 * Datos del perfil cargados desde «Esto mismo te pasa en N de tus M ofertas» (R31-08). Puro.
 * Igual que `withCurrentSkillLevels`: `decision.checklist` es una foto del momento de la evaluación;
 * para que las ofertas afectadas muestren el dato nuevo sin evaluar de nuevo (sin modelo) se
 * superponen los datos actuales al mostrar. El estado lo decide el código, con la misma regla de
 * `buildChecklist` (inglés por CEFR, años por número).
 */

export type CurrentProfileFacts = {
  englishCefr?: string | null;
  yearsTotal?: number | null;
};

const PEDIDO_INGLES: Record<string, number> = { basico: 1, intermedio: 2, avanzado: 3, nativo: 4 };

function foldWord(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Nivel de inglés que pide la fila («Inglés avanzado»), o null si no se lee. */
function englishAsked(pide: string): number | null {
  const m = /ingles\s+(basico|intermedio|avanzado|nativo)/.exec(foldWord(pide));
  return m ? (PEDIDO_INGLES[m[1]!] ?? null) : null;
}

/** Años que pide la fila («3 años de ventas»), o null si no empieza con un número. */
function yearsAsked(pide: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*a[ñn]os/i.exec(pide);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function withCurrentProfileFacts<C extends { items: ChecklistItem[] }>(
  checklist: C,
  facts: CurrentProfileFacts,
): C {
  const myEnglish = englishRankFromCefr(facts.englishCefr);
  const years =
    typeof facts.yearsTotal === "number" && Number.isFinite(facts.yearsTotal)
      ? facts.yearsTotal
      : null;
  if (myEnglish === null && years === null) return checklist;
  const items = checklist.items.map((it): ChecklistItem => {
    if (it.id === "ingles" && myEnglish !== null && facts.englishCefr) {
      const asked = englishAsked(it.pide);
      if (asked === null) return it;
      return {
        ...it,
        tenes: facts.englishCefr.trim().toUpperCase(),
        status: asked <= myEnglish ? "cumple" : "no_cumple",
        fuente: { ...it.fuente, tenes: "perfil" },
      };
    }
    if (it.id === "anos" && years !== null) {
      const asked = yearsAsked(it.pide);
      if (asked === null) return it;
      return {
        ...it,
        tenes: `${years} años`,
        status: asked > years ? "no_cumple" : "cumple",
        fuente: { ...it.fuente, tenes: "perfil" },
      };
    }
    return it;
  });
  return { ...checklist, items };
}

// --- Pedido del modal de un solo campo ---

export type ProfileFieldUpdate =
  | { field: "ingles"; value: string }
  | { field: "anos"; value: number }
  | { field: "pais"; value: string };

export type ProfileFieldParse =
  { ok: true; update: ProfileFieldUpdate } | { ok: false; field: "field" | "value" };

/** Valida el pedido: solo inglés (CEFR), años (0 a 60) y país (ISO-2). Devuelve qué campo falla, nunca el valor. */
export function parseProfileFieldUpdate(input: unknown): ProfileFieldParse {
  const raw = (input ?? {}) as { field?: unknown; value?: unknown };
  const value = typeof raw.value === "string" ? raw.value.trim() : null;
  if (raw.field === "ingles") {
    return value && /^[ABC][12]$/i.test(value)
      ? { ok: true, update: { field: "ingles", value: value.toUpperCase() } }
      : { ok: false, field: "value" };
  }
  if (raw.field === "anos") {
    if (!value || !/^\d{1,2}(?:[.,]\d)?$/.test(value)) return { ok: false, field: "value" };
    const n = Number(value.replace(",", "."));
    return n >= 0 && n <= 60
      ? { ok: true, update: { field: "anos", value: n } }
      : { ok: false, field: "value" };
  }
  if (raw.field === "pais") {
    return value && /^[A-Za-z]{2}$/.test(value)
      ? { ok: true, update: { field: "pais", value: value.toUpperCase() } }
      : { ok: false, field: "value" };
  }
  return { ok: false, field: "field" };
}
