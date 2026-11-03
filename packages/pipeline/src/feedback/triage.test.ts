import { describe, expect, it } from "vitest";
import {
  feedbackCsv,
  filterFeedback,
  parseFeedbackFilters,
  readableActions,
  type TriageRow,
} from "./triage";

const row = (over: Partial<TriageRow>): TriageRow => ({
  id: "f1",
  createdAt: new Date("2026-11-27T14:00:00Z"),
  category: "algo_no_anduvo",
  path: "/jobs/123",
  message: "No carga",
  person: "a1b2c3",
  career: "abogacia",
  status: "nuevo",
  actions: [],
  ...over,
});

describe("parseFeedbackFilters (C8-17)", () => {
  it("solo acepta valores conocidos; lo demás se ignora", () => {
    expect(
      parseFeedbackFilters({
        carrera: "abogacia",
        categoria: "idea",
        pagina: "/jobs",
        desde: "2026-11-26",
        hasta: "2026-11-30",
        estado: "visto",
      }),
    ).toEqual({
      career: "abogacia",
      category: "idea",
      path: "/jobs",
      from: "2026-11-26",
      to: "2026-11-30",
      status: "visto",
    });
    expect(
      parseFeedbackFilters({
        carrera: "x",
        categoria: "<b>",
        pagina: "jobs",
        desde: "ayer",
        estado: "?",
      }),
    ).toEqual({ career: null, category: null, path: null, from: null, to: null, status: null });
  });
});

describe("filterFeedback", () => {
  const rows = [
    row({ id: "a" }),
    row({ id: "b", category: "idea", career: "finanzas_contabilidad", path: "/hoy" }),
    row({ id: "c", createdAt: new Date("2026-11-20T12:00:00Z"), status: "resuelto" }),
  ];
  it("por carrera, categoría, página (prefijo), fecha (día de Argentina) y estado", () => {
    const f = (q: Record<string, string>) =>
      filterFeedback(rows, parseFeedbackFilters(q)).map((r) => r.id);
    expect(f({ carrera: "abogacia" })).toEqual(["a", "c"]);
    expect(f({ categoria: "idea" })).toEqual(["b"]);
    expect(f({ pagina: "/jobs" })).toEqual(["a", "c"]);
    expect(f({ desde: "2026-11-26" })).toEqual(["a", "b"]);
    expect(f({ hasta: "2026-11-20" })).toEqual(["c"]);
    expect(f({ estado: "resuelto" })).toEqual(["c"]);
  });
});

describe("readableActions", () => {
  it("las últimas acciones del chip, en llano y con la hora de Argentina", () => {
    expect(
      readableActions([
        { type: "navigate", text: "/hoy", time: "2026-11-27T13:58:00Z" },
        { type: "click", text: "Ver oferta", time: "2026-11-27T13:59:30Z" },
        { type: "click", text: "", time: "no es fecha" },
      ]),
    ).toEqual(["10:58 · fue a /hoy", "10:59 · tocó «Ver oferta»", "tocó un elemento sin texto"]);
  });
});

describe("feedbackCsv", () => {
  it("sin fórmulas de planilla y con BOM; nunca email", () => {
    const csv = feedbackCsv([
      row({ message: '=HYPERLINK("http://x")', path: "+evil", actions: [] }),
      row({ id: "f2", message: "una\nlínea, con coma", person: "@cmd" }),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const body = csv.replace("﻿", "");
    expect(body.split("\r\n")[0]).toBe(
      "fecha,carrera,categoria,estado,pagina,persona,mensaje,acciones",
    );
    expect(body).not.toMatch(/(^|,)"?[=+\-@]/m);
    expect(body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(body).toContain('"una\nlínea, con coma"');
  });
});
