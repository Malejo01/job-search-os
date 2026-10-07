import type { JobEvent } from "@job-search-os/pipeline";
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
