import { describe, expect, it } from "vitest";
import {
  FEEDBACK_DRAFT_KEY,
  FEEDBACK_DRAFT_MAX_AGE_MS,
  clearFeedbackDraft,
  parseFeedbackDraft,
  readFeedbackDraft,
  serializeFeedbackDraft,
  writeFeedbackDraft,
  type DraftStorage,
} from "../lib/beta-feedback-draft";

function memory(
  initial: Record<string, string> = {},
): DraftStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const NOW = Date.parse("2026-11-25T12:00:00Z");

describe("borrador del comentario (sessionStorage)", () => {
  it("la clave no lleva datos de la persona", () => {
    expect(FEEDBACK_DRAFT_KEY).toMatch(/^[a-z0-9:_-]+$/i);
    expect(FEEDBACK_DRAFT_KEY).not.toMatch(/@|user|email/i);
  });

  it("guarda y lee lo escrito", () => {
    const st = memory();
    writeFeedbackDraft(st, { category: "idea", message: "Hola", suggestion: "Más claro" }, NOW);
    expect(readFeedbackDraft(st, NOW + 1000)).toEqual({
      category: "idea",
      message: "Hola",
      suggestion: "Más claro",
    });
  });

  it("un borrador vacío no se guarda y borra el anterior", () => {
    const st = memory();
    writeFeedbackDraft(st, { category: "idea", message: "Hola", suggestion: "" }, NOW);
    writeFeedbackDraft(st, { category: "", message: "  ", suggestion: "" }, NOW);
    expect(st.data[FEEDBACK_DRAFT_KEY]).toBeUndefined();
  });

  it("solo con categoría elegida también se conserva", () => {
    const st = memory();
    writeFeedbackDraft(st, { category: "confuso", message: "", suggestion: "" }, NOW);
    expect(readFeedbackDraft(st, NOW)?.category).toBe("confuso");
  });

  it("un borrador viejo (más de 12 horas) se descarta", () => {
    const st = memory();
    writeFeedbackDraft(st, { category: "idea", message: "Hola", suggestion: "" }, NOW);
    expect(readFeedbackDraft(st, NOW + FEEDBACK_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(st.data[FEEDBACK_DRAFT_KEY]).toBeUndefined();
  });

  it("clearFeedbackDraft lo borra", () => {
    const st = memory();
    writeFeedbackDraft(st, { category: "idea", message: "Hola", suggestion: "" }, NOW);
    clearFeedbackDraft(st);
    expect(readFeedbackDraft(st, NOW)).toBeNull();
  });

  it("contenido roto o con otra forma se ignora (falla cerrado)", () => {
    expect(parseFeedbackDraft("no es json", NOW)).toBeNull();
    expect(parseFeedbackDraft("[]", NOW)).toBeNull();
    expect(parseFeedbackDraft(JSON.stringify({ v: 2, message: "x", at: NOW }), NOW)).toBeNull();
    expect(
      parseFeedbackDraft(
        JSON.stringify({ v: 1, message: 5, category: "", suggestion: "", at: NOW }),
        NOW,
      ),
    ).toBeNull();
    expect(parseFeedbackDraft(null, NOW)).toBeNull();
  });

  it("una categoría desconocida se descarta pero se conserva el texto", () => {
    const raw = serializeFeedbackDraft({ category: "otra", message: "Texto", suggestion: "" }, NOW);
    expect(parseFeedbackDraft(raw, NOW)).toEqual({
      category: "",
      message: "Texto",
      suggestion: "",
    });
  });

  it("un sessionStorage que tira error no rompe nada", () => {
    const roto: DraftStorage = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("lleno");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(() =>
      writeFeedbackDraft(roto, { category: "idea", message: "Hola", suggestion: "" }, NOW),
    ).not.toThrow();
    expect(readFeedbackDraft(roto, NOW)).toBeNull();
    expect(() => clearFeedbackDraft(roto)).not.toThrow();
  });
});
