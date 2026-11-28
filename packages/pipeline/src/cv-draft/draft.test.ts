import { describe, expect, it } from "vitest";
import { initialCvChatState, setWork, type CvChatState } from "../cv-chat/state";
import {
  CV_DRAFT_MAX_BYTES,
  CV_DRAFT_RETENTION_DAYS,
  cvChatDraftSections,
  cvChatDraftHasContent,
  cvDraftExpired,
  cvDraftFits,
  parseCvChatDraft,
  parseCvCoachDraft,
} from "./draft";

/** Borrador automático (R33-02): reglas puras. Datos inventados. */
const NOW = new Date("2026-12-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const withWork = (s: CvChatState): CvChatState =>
  setWork(s, 0, { organization: "Empresa A", title: "Cargo A" });

describe("cvDraftExpired: 30 días sin uso", () => {
  it("el plazo es de 30 días", () => {
    expect(CV_DRAFT_RETENTION_DAYS).toBe(30);
  });

  it("a los 29 días y 23 horas sigue vivo; a los 30 días justos vence", () => {
    expect(cvDraftExpired(new Date(NOW.getTime() - 29.99 * DAY), NOW)).toBe(false);
    expect(cvDraftExpired(new Date(NOW.getTime() - 30 * DAY), NOW)).toBe(true);
    expect(cvDraftExpired(new Date(NOW.getTime() - 90 * DAY), NOW)).toBe(true);
  });

  it("una fecha futura o inválida no vence (y una inválida se trata como vencida: falla cerrado)", () => {
    expect(cvDraftExpired(new Date(NOW.getTime() + DAY), NOW)).toBe(false);
    expect(cvDraftExpired(new Date("no es fecha"), NOW)).toBe(true);
  });
});

describe("cvChatDraftSections: qué hay sin confirmar", () => {
  it("un estado recién sembrado no tiene nada sin confirmar", () => {
    const s = initialCvChatState({ target: "Puesto A" });
    expect(cvChatDraftSections(s)).toEqual([]);
    expect(cvChatDraftHasContent(s)).toBe(false);
  });

  it("un trabajo dicho en la charla es experiencia sin confirmar", () => {
    const s = withWork(initialCvChatState());
    expect(cvChatDraftSections(s)).toEqual(["experiencia"]);
    expect(cvChatDraftHasContent(s)).toBe(true);
  });

  it("un proyecto cuenta como experiencia; estudios y certificaciones, como estudios", () => {
    const base = initialCvChatState();
    const proyecto: CvChatState = {
      ...base,
      projects: [{ name: "Proyecto A", role: null, description: null, stack: [], link: null }],
    };
    expect(cvChatDraftSections(proyecto)).toEqual(["experiencia"]);
    const estudios: CvChatState = {
      ...base,
      certifications: [{ issuer: "Instituto A", title: "Curso A", startMonth: null }],
    };
    expect(cvChatDraftSections(estudios)).toEqual(["estudios"]);
    const todo: CvChatState = {
      ...withWork(base),
      education: [
        { institution: "Institución A", title: "Título A", startMonth: null, endMonth: null },
      ],
    };
    expect(cvChatDraftSections(todo)).toEqual(["experiencia", "estudios"]);
  });

  it("lo contado para el resumen profesional es una sección sin confirmar, antes que la experiencia", () => {
    const base = initialCvChatState({ guided: true });
    const s: CvChatState = {
      ...withWork(base),
      summary: { ...base.summary, goal: "Un equipo chico" },
    };
    expect(cvChatDraftSections(s)).toEqual(["resumen", "experiencia"]);
    expect(cvChatDraftSections({ ...base, summary: { ...base.summary, experience: " " } })).toEqual(
      [],
    );
  });

  it("un trabajo sin empresa ni cargo todavía no cuenta", () => {
    const s = setWork(initialCvChatState(), 0, {});
    expect(cvChatDraftSections(s)).toEqual([]);
  });

  it("lo que ya estaba confirmado (`confirmed`) no es borrador", () => {
    const s: CvChatState = {
      ...initialCvChatState(),
      confirmed: [
        {
          kind: "educacion",
          organization: "Institución A",
          title: "Título A",
          startMonth: null,
          endMonth: null,
          bullets: [],
        },
      ],
    };
    expect(cvChatDraftSections(s)).toEqual([]);
  });

  it("con respuestas dadas hay contenido aunque todavía no haya una sección", () => {
    const s = { ...initialCvChatState(), turns: 2, answered: ["target"] };
    expect(cvChatDraftHasContent(s)).toBe(true);
  });
});

describe("parseCvChatDraft: lo que vuelve de la base se valida como entrada no confiable", () => {
  const draft = (state: unknown, v: number = 1) => ({ v, state });

  it("acepta un estado válido", () => {
    const s = withWork(initialCvChatState({ target: "Puesto A" }));
    const r = parseCvChatDraft(draft(s));
    expect(r?.state.works[0]?.organization).toBe("Empresa A");
  });

  it("rechaza otra versión, claves de más y estados fuera de esquema", () => {
    const s = initialCvChatState();
    expect(parseCvChatDraft(draft(s, 2))).toBeNull();
    expect(parseCvChatDraft({ v: 1, state: s, extra: true })).toBeNull();
    expect(parseCvChatDraft(draft({ ...s, turns: 99 }))).toBeNull();
    expect(parseCvChatDraft(draft({ ...s, target: "x".repeat(500) }))).toBeNull();
    expect(parseCvChatDraft(null)).toBeNull();
    expect(parseCvChatDraft("texto")).toBeNull();
  });
});

describe("parseCvCoachDraft", () => {
  const card = {
    kind: "note",
    key: "cc:1",
    historyId: null,
    text: "Algo que dijo y no se pudo ubicar",
    about: "patch",
  };

  it("acepta una lista vacía de propuestas y una tarjeta válida", () => {
    expect(parseCvCoachDraft({ v: 1, cards: [] })).toEqual({ v: 1, cards: [] });
    const r = parseCvCoachDraft({ v: 1, cards: [card] });
    // si el esquema de tarjetas cambia, este test avisa: la tarjeta de ejemplo tiene que seguir siendo válida
    expect(r?.cards).toHaveLength(1);
  });

  it("rechaza más de 12 tarjetas, tarjetas inválidas y claves de más", () => {
    expect(parseCvCoachDraft({ v: 1, cards: Array.from({ length: 13 }, () => card) })).toBeNull();
    expect(parseCvCoachDraft({ v: 1, cards: [{ kind: "bullets" }] })).toBeNull();
    expect(parseCvCoachDraft({ v: 1, cards: [], messages: ["hola"] })).toBeNull();
    expect(parseCvCoachDraft({ v: 2, cards: [] })).toBeNull();
  });
});

describe("cvDraftFits: tope de tamaño", () => {
  it("un borrador común entra y uno enorme no", () => {
    expect(cvDraftFits({ v: 1, cards: [] })).toBe(true);
    expect(cvDraftFits({ big: "x".repeat(CV_DRAFT_MAX_BYTES) })).toBe(false);
  });

  it("cuenta bytes, no letras: las tildes ocupan más", () => {
    expect(cvDraftFits({ t: "á".repeat(CV_DRAFT_MAX_BYTES / 2) })).toBe(false);
  });
});
