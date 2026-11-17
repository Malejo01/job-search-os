import { describe, expect, it } from "vitest";
import { projectCardSchema } from "../profile-agent/schemas";
import { CV_ISSUE_PRIORITY, CV_ISSUE_TYPES, cvIssuePriority } from "./issues";
import { CV_COACH_API, CV_COACH_PAGES, CV_COACH_STORAGE_KEYS } from "./routes";
import {
  cvCoachAnswerSchema,
  cvCoachSignedIssuesSchema,
  cvCoachStateSchema,
  cvCoachTurnOutputSchema,
  cvReviewOutputSchema,
} from "./schemas";

const issue = {
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: "0b3f2c4e-1111-4222-8333-944455556666", field: "bullets" },
  quote: null,
  skillSlug: null,
  severity: "alta",
};

const turn = {
  patch: {
    title: null,
    organization: null,
    startMonth: "2025-04",
    endMonth: null,
    isCurrent: true,
    bullets: ["Reduje el tiempo de carga de los reportes"],
    link: null,
    stack: [],
  },
  extras: [{ kind: "proyecto", text: "Proyecto 1, un buscador de eventos con mapa", ref: null }],
  declined: false,
  nextQuestion: "¿Qué resultado tuvo ese cambio en Empresa A?",
};

describe("cv_review: salida del modelo (ADR-038 §3)", () => {
  it("acepta problemas tipados", () => {
    expect(cvReviewOutputSchema.safeParse({ issues: [issue] }).success).toBe(true);
  });

  it("rechaza texto libre del modelo o claves de más", () => {
    const extra = { ...issue, message: "Tu CV es flojo" };
    expect(cvReviewOutputSchema.safeParse({ issues: [extra] }).success).toBe(false);
    expect(cvReviewOutputSchema.safeParse({ issues: [], resumen: "x" }).success).toBe(false);
  });

  it("rechaza tipos de problema inventados y referencias con caracteres raros", () => {
    expect(
      cvReviewOutputSchema.safeParse({ issues: [{ ...issue, type: "falta_foto" }] }).success,
    ).toBe(false);
    const ref = { section: "experience", itemId: "x'; drop table", field: null };
    expect(cvReviewOutputSchema.safeParse({ issues: [{ ...issue, ref }] }).success).toBe(false);
  });

  it("acota la cantidad propuesta", () => {
    const many = Array.from({ length: 16 }, () => issue);
    expect(cvReviewOutputSchema.safeParse({ issues: many }).success).toBe(false);
  });

  it("todos los tipos tienen prioridad, sin repetirse", () => {
    expect(new Set(CV_ISSUE_PRIORITY).size).toBe(CV_ISSUE_TYPES.length);
    for (const t of CV_ISSUE_TYPES) expect(cvIssuePriority(t)).toBeGreaterThanOrEqual(0);
  });
});

describe("cv_coach_turn: salida del modelo", () => {
  it("acepta extracción multi-campo, extras y un borrador de pregunta", () => {
    expect(cvCoachTurnOutputSchema.safeParse(turn).success).toBe(true);
  });

  it("no deja que el modelo diga qué problema resolvió", () => {
    expect(cvCoachTurnOutputSchema.safeParse({ ...turn, resolves: ["iss:0"] }).success).toBe(false);
  });

  it("rechaza links que no son https y fechas inválidas", () => {
    const http = { ...turn, patch: { ...turn.patch, link: "http://proyecto.example" } };
    expect(cvCoachTurnOutputSchema.safeParse(http).success).toBe(false);
    const date = { ...turn, patch: { ...turn.patch, startMonth: "2025-13" } };
    expect(cvCoachTurnOutputSchema.safeParse(date).success).toBe(false);
  });

  it("limpia links y emails de las viñetas extraídas", () => {
    const parsed = cvCoachTurnOutputSchema.parse({
      ...turn,
      patch: { ...turn.patch, bullets: ["Armé el sitio https://algo.example para clientes"] },
    });
    expect(parsed.patch.bullets[0]).not.toMatch(/https?:/);
  });
});

describe("lo que viaja por el navegador (ADR-038 §8)", () => {
  it("el avance no tiene dónde llevar el CV ni la charla", () => {
    const state = {
      stage: "chat",
      current: "iss:0",
      resolved: [],
      skipped: [],
      followUps: 0,
      failures: 0,
      turnsShown: 1,
    };
    expect(cvCoachStateSchema.safeParse(state).success).toBe(true);
    for (const key of ["cvText", "messages", "history", "answers", "costUsd"]) {
      expect(cvCoachStateSchema.safeParse({ ...state, [key]: "x" }).success).toBe(false);
    }
  });

  it("la lista firmada exige firma, vencimiento y flowId", () => {
    const signed = {
      v: 1,
      flowId: "0123456789ab",
      expiresAt: 1_800_000_000,
      target: "Desarrollador web",
      issues: [{ ...issue, id: "iss:0", source: "model" }],
      mac: "a".repeat(43),
    };
    expect(cvCoachSignedIssuesSchema.safeParse(signed).success).toBe(true);
    expect(cvCoachSignedIssuesSchema.safeParse({ ...signed, mac: "" }).success).toBe(false);
    expect(cvCoachSignedIssuesSchema.safeParse({ ...signed, flowId: "zz" }).success).toBe(false);
    const sinFuente = { ...signed, issues: [{ ...issue, id: "iss:0" }] };
    expect(cvCoachSignedIssuesSchema.safeParse(sinFuente).success).toBe(false);
  });

  it("respuestas: texto acotado, «no tengo», una de dos opciones o terminar", () => {
    expect(
      cvCoachAnswerSchema.safeParse({ kind: "text", issueId: "iss:1", text: "Sí" }).success,
    ).toBe(true);
    expect(cvCoachAnswerSchema.safeParse({ kind: "none", issueId: "iss:1" }).success).toBe(true);
    expect(
      cvCoachAnswerSchema.safeParse({ kind: "choice", issueId: "iss:1", choice: 1 }).success,
    ).toBe(true);
    expect(
      cvCoachAnswerSchema.safeParse({ kind: "choice", issueId: "iss:1", choice: 2 }).success,
    ).toBe(false);
    expect(cvCoachAnswerSchema.safeParse({ kind: "finish" }).success).toBe(true);
    const long = { kind: "text", issueId: "iss:1", text: "x".repeat(2001) };
    expect(cvCoachAnswerSchema.safeParse(long).success).toBe(false);
  });

  it("rutas y claves bajo prefijos propios, sin localStorage", () => {
    for (const p of Object.values(CV_COACH_PAGES)) expect(p.startsWith("/cv/coach")).toBe(true);
    for (const p of Object.values(CV_COACH_API)) expect(p.startsWith("/api/cv-coach/")).toBe(true);
    for (const k of Object.values(CV_COACH_STORAGE_KEYS))
      expect(k.startsWith("jso:coach:")).toBe(true);
  });
});

describe("tarjeta de proyecto (D2, contrato para R12-5)", () => {
  const card = {
    kind: "project",
    id: "proj:0",
    name: "Proyecto 1",
    role: "Desarrollo y diseño",
    link: "https://proyecto1.example",
    stack: ["Next.js", "PostgreSQL"],
    startMonth: null,
    endMonth: null,
    bullets: [],
    bulletsFromCv: false,
  };

  it("acepta un proyecto con link https", () => {
    expect(projectCardSchema.safeParse(card).success).toBe(true);
    expect(projectCardSchema.safeParse({ ...card, link: null, role: null }).success).toBe(true);
  });

  it("rechaza links http, con email o largos, y links en el nombre", () => {
    for (const link of [
      "http://proyecto1.example",
      "https://a@b.example",
      `https://${"a".repeat(200)}.example`,
    ]) {
      expect(projectCardSchema.safeParse({ ...card, link }).success).toBe(false);
    }
    expect(projectCardSchema.safeParse({ ...card, name: "ver https://x.example" }).success).toBe(
      false,
    );
  });
});
