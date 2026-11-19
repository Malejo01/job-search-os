import { describe, expect, it } from "vitest";
import {
  checkPromptSize,
  FIELD_PROMPT_MAX_CHARS,
  JD_PROMPT_MAX_CHARS,
  PROMPT_MAX_CHARS,
  renderJob,
  type JobForPrompt,
} from "./evaluation";

const base: JobForPrompt = {
  title: "Backend Engineer",
  companyRaw: "Empresa A",
  jdText: "Buscamos una persona para APIs en Node. ".repeat(10),
};

const HUGE = "x".repeat(2_500_000);

/** Largo de la línea de un campo dentro del prompt. */
const lineOf = (prompt: string, label: string) =>
  prompt.split("\n").find((l) => l.startsWith(`- ${label}:`)) ?? "";

describe("renderJob: cada campo de texto libre tiene su tope", () => {
  it("el contrato enorme no entra entero", () => {
    const out = renderJob({ ...base, contractType: HUGE });
    expect(out.length).toBeLessThan(5_000);
    expect(lineOf(out, "Contrato").length).toBeLessThanOrEqual(FIELD_PROMPT_MAX_CHARS + 20);
  });

  it("modalidad, período y fecha enormes se recortan", () => {
    const out = renderJob({
      ...base,
      modality: HUGE,
      salaryMinUsd: 1000,
      salaryPeriod: HUGE,
      postedAt: HUGE,
    });
    expect(out.length).toBeLessThan(5_000);
  });

  it("países y etiquetas enormes se recortan por elemento y por cantidad", () => {
    const out = renderJob({
      ...base,
      countriesAllowed: Array.from({ length: 100_000 }, () => HUGE.slice(0, 1_000)),
      badges: Array.from({ length: 100_000 }, () => HUGE.slice(0, 1_000)),
    });
    expect(out.length).toBeLessThan(20_000);
  });

  it("ningún campo supera su tope con todos enormes a la vez", () => {
    const out = renderJob({
      title: HUGE,
      companyRaw: HUGE,
      locationRaw: HUGE,
      contractType: HUGE,
      modality: HUGE,
      salaryMinUsd: 1,
      salaryPeriod: HUGE,
      salaryNote: HUGE,
      countriesAllowed: [HUGE],
      badges: [HUGE],
      postedAt: HUGE,
      jdText: HUGE,
    });
    const header = out.split("\n\nDescripción del puesto:")[0]!;
    for (const l of header.split("\n")) {
      expect(l.length).toBeLessThanOrEqual(FIELD_PROMPT_MAX_CHARS + 300);
    }
    expect(out.length).toBeLessThan(JD_PROMPT_MAX_CHARS + 5_000);
  });

  it("un aviso normal no cambia", () => {
    const out = renderJob({
      ...base,
      contractType: "Full time",
      modality: "remoto",
      countriesAllowed: ["AR", "UY"],
      badges: ["Nuevo"],
    });
    expect(out).toContain("- Contrato: Full time");
    expect(out).toContain("- Países permitidos: AR, UY");
    expect(out).toContain("- Badges: Nuevo");
  });

  it("2 MB en cada campo se procesan en menos de 100 ms", () => {
    const job: JobForPrompt = {
      title: HUGE,
      companyRaw: HUGE,
      locationRaw: HUGE,
      contractType: HUGE,
      modality: HUGE,
      salaryMinUsd: 1,
      salaryPeriod: HUGE,
      salaryNote: HUGE,
      countriesAllowed: [HUGE.slice(0, 2_000_000)],
      badges: [HUGE.slice(0, 2_000_000)],
      postedAt: HUGE.slice(0, 2_000_000),
      jdText: HUGE.slice(0, 2_000_000),
    };
    const start = performance.now();
    renderJob(job, { delimit: true });
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("checkPromptSize: el largo del prompt completo", () => {
  it("un prompt normal da ok con el total", () => {
    const r = checkPromptSize({ job: "a".repeat(1_000), profile_summary: "b".repeat(500) });
    expect(r).toMatchObject({ ok: true, value: { chars: 1_500 } });
  });

  it("ignora las variables que no son texto", () => {
    const r = checkPromptSize({ job: "abc", had_full_jd: true });
    expect(r).toMatchObject({ ok: true, value: { chars: 3 } });
  });

  it("supera el máximo: devuelve un error con el motivo y no lanza", () => {
    const r = checkPromptSize({ job: "a".repeat(PROMPT_MAX_CHARS + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.chars).toBe(PROMPT_MAX_CHARS + 1);
      expect(r.error.max).toBe(PROMPT_MAX_CHARS);
      expect(r.error.reason).toContain("prompt");
    }
  });

  it("acepta un máximo distinto", () => {
    expect(checkPromptSize({ job: "abcdef" }, 5).ok).toBe(false);
    expect(checkPromptSize({ job: "abcde" }, 5).ok).toBe(true);
  });
});
