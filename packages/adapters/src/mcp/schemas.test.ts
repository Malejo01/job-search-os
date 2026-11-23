import {
  MAX_ANSWER_CHARS,
  MAX_ANSWER_QUERY_CHARS,
  MAX_ANSWER_QUESTION_CHARS,
  MAX_JD_INPUT_CHARS,
  type JobEvent,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import * as schemas from "./schemas";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const events: readonly [JobEvent, ...JobEvent[]] = ["apply", "discard"];
const setStatus = schemas.setStatusInput(events);

describe("esquemas MCP", () => {
  it("rechaza ids que no son UUID", () => {
    expect(schemas.getJobInput.safeParse({ id: "abc" }).success).toBe(false);
    expect(schemas.getJobInput.safeParse({ id: UUID }).success).toBe(true);
    expect(setStatus.safeParse({ id: "1", event: "apply" }).success).toBe(false);
    expect(schemas.pasteJdInput.safeParse({ id: "x", text: "a".repeat(200) }).success).toBe(false);
  });

  it("rechaza estados y eventos inexistentes", () => {
    expect(schemas.listJobsInput.safeParse({ status: "inventado" }).success).toBe(false);
    expect(schemas.listJobsInput.safeParse({ status: "todas" }).success).toBe(true);
    expect(setStatus.safeParse({ id: UUID, event: "evaluated" }).success).toBe(false);
    expect(setStatus.safeParse({ id: UUID, event: "apply" }).success).toBe(true);
  });

  it("aplica límites", () => {
    expect(schemas.listJobsInput.safeParse({ limit: 0 }).success).toBe(false);
    expect(schemas.listJobsInput.safeParse({ limit: 51 }).success).toBe(false);
    expect(schemas.listJobsInput.safeParse({ score_min: 11 }).success).toBe(false);
    expect(schemas.pasteJdInput.safeParse({ id: UUID, text: "corto" }).success).toBe(false);
    // S-2: tope de largo de la JD
    const long = "a".repeat(MAX_JD_INPUT_CHARS + 1);
    expect(schemas.pasteJdInput.safeParse({ id: UUID, text: long }).success).toBe(false);
    expect(
      schemas.pasteJdInput.safeParse({ id: UUID, text: "a".repeat(MAX_JD_INPUT_CHARS) }).success,
    ).toBe(true);
    expect(
      schemas.addJobInput.safeParse({ title: "Dev", company: "Empresa A", jd_text: long }).success,
    ).toBe(false);
    expect(schemas.saveApplicationAnswersInput.safeParse({ job_id: UUID, qa: [] }).success).toBe(
      false,
    );
    expect(
      schemas.saveAnswerInput.safeParse({ question: "q?x", answer: "a", lang: "fr" }).success,
    ).toBe(false);
    expect(
      schemas.addJobInput.safeParse({ title: "Dev", company: "Empresa A", modality: "luna" })
        .success,
    ).toBe(false);
  });

  it("las respuestas tienen el mismo tope por campo que las acciones web", () => {
    const q = "q".repeat(MAX_ANSWER_QUESTION_CHARS);
    const a = "a".repeat(MAX_ANSWER_CHARS);
    const okSave = { question: q, answer: a, lang: "es" };
    expect(schemas.saveAnswerInput.safeParse(okSave).success).toBe(true);
    expect(schemas.saveAnswerInput.safeParse({ ...okSave, question: q + "x" }).success).toBe(false);
    expect(schemas.saveAnswerInput.safeParse({ ...okSave, answer: a + "x" }).success).toBe(false);
    const okForm = { job_id: UUID, qa: [{ question: q, answer: a }] };
    expect(schemas.saveApplicationAnswersInput.safeParse(okForm).success).toBe(true);
    expect(
      schemas.saveApplicationAnswersInput.safeParse({
        job_id: UUID,
        qa: [{ question: q + "x", answer: "a" }],
      }).success,
    ).toBe(false);
    expect(
      schemas.saveApplicationAnswersInput.safeParse({
        job_id: UUID,
        qa: [{ question: "q", answer: a + "x" }],
      }).success,
    ).toBe(false);
  });

  it("el formulario completo cabe en el tope de cuerpo del pedido (256 KB)", () => {
    const BODY_BYTES = 256 * 1024;
    // Peor caso por el esquema: 60 pares con los máximos por campo
    const worst = {
      job_id: UUID,
      qa: Array.from({ length: 60 }, () => ({
        question: "q".repeat(MAX_ANSWER_QUESTION_CHARS),
        answer: "a".repeat(MAX_ANSWER_CHARS),
      })),
    };
    expect(schemas.saveApplicationAnswersInput.safeParse(worst).success).toBe(false);
    // El total permitido, a 3 bytes por carácter, entra en el cuerpo
    const TOTAL = 60_000;
    expect(TOTAL * 3).toBeLessThan(BODY_BYTES);
    const withTotal = (chars: number) => ({
      job_id: UUID,
      qa: [{ question: "q", answer: "a".repeat(chars - 1) }],
    });
    expect(schemas.saveApplicationAnswersInput.safeParse(withTotal(9_000)).success).toBe(true);
    const spread = (chars: number) => ({
      job_id: UUID,
      qa: Array.from({ length: 6 }, () => ({ question: "q", answer: "a".repeat(chars / 6 - 1) })),
    });
    expect(schemas.saveApplicationAnswersInput.safeParse(spread(TOTAL)).success).toBe(true);
    expect(schemas.saveApplicationAnswersInput.safeParse(spread(TOTAL + 6)).success).toBe(false);
    // Un formulario grande y legítimo (60 respuestas de 900 caracteres) sigue pasando
    const big = {
      job_id: UUID,
      qa: Array.from({ length: 60 }, () => ({ question: "¿Pregunta?", answer: "a".repeat(900) })),
    };
    expect(schemas.saveApplicationAnswersInput.safeParse(big).success).toBe(true);
    // Una sola respuesta del máximo por campo también pasa
    const one = {
      job_id: UUID,
      qa: [
        {
          question: "q".repeat(MAX_ANSWER_QUESTION_CHARS),
          answer: "a".repeat(MAX_ANSWER_CHARS),
        },
      ],
    };
    expect(schemas.saveApplicationAnswersInput.safeParse(one).success).toBe(true);
  });

  it("la búsqueda en el banco tiene tope de largo", () => {
    expect(
      schemas.listAnswersInput.safeParse({ query: "x".repeat(MAX_ANSWER_QUERY_CHARS) }).success,
    ).toBe(true);
    expect(
      schemas.listAnswersInput.safeParse({ query: "x".repeat(MAX_ANSWER_QUERY_CHARS + 1) }).success,
    ).toBe(false);
  });

  it("ningún campo de texto del MCP queda sin tope", () => {
    type Field = {
      constructor: { name: string };
      unwrap?: () => Field;
      safeParse: (v: unknown) => { success: boolean };
    };
    const unbounded: string[] = [];
    const inspect = (label: string, field: Field) => {
      const inner = field.unwrap ? field.unwrap() : field;
      if (inner.constructor.name === "ZodArray") return;
      if (inner.constructor.name === "ZodString" && inner.safeParse("x".repeat(70_000)).success) {
        unbounded.push(label);
      }
    };
    for (const [name, value] of Object.entries(schemas)) {
      if (!("shape" in value)) continue;
      for (const [key, field] of Object.entries(
        (value as { shape: Record<string, Field> }).shape,
      )) {
        inspect(`${name}.${key}`, field);
      }
    }
    // Los textos dentro de qa se prueban arriba, uno por uno
    expect(unbounded).toEqual([]);
  });

  it("ningún esquema acepta userId ni user_id", () => {
    // setStatusInput es una fábrica: se prueba la instancia
    const all = Object.entries({ ...schemas, setStatusInput: setStatus });
    let checked = 0;
    for (const [name, value] of all) {
      if (!("shape" in value)) continue;
      const keys = Object.keys((value as { shape: object }).shape);
      expect(keys, name).not.toContain("userId");
      expect(keys, name).not.toContain("user_id");
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});
