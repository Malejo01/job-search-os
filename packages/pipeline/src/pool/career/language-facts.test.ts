import { describe, expect, it } from "vitest";
import abogacia from "../../../test/fixtures/carreras/abogacia.json";
import comunicacion from "../../../test/fixtures/carreras/comunicacion.json";
import rrii from "../../../test/fixtures/carreras/relaciones_internacionales.json";
import { detectJobLanguage } from "../../normalize/language";
import { buildCareerMarket } from "./career-market";
import { detectEnglish } from "./english";
import { jobLanguageFacts } from "./language-facts";

const TEXTS = [abogacia, comunicacion, rrii].flatMap((d) => d.casos.map((c) => c.jd_text));

describe("jobLanguageFacts (C8-15)", () => {
  it("da lo mismo que detectJobLanguage y detectEnglish sobre el texto", () => {
    const en =
      "We are looking for a Program Officer to join our team. You will manage the grants portfolio and work with our partners. We offer a flexible schedule and you will have a great team. Fluent English is required (C1) and Spanish is a plus.";
    for (const text of [...TEXTS, en]) {
      const d = detectEnglish(text, null);
      expect(jobLanguageFacts(text, null)).toEqual({
        jdLanguage: detectJobLanguage(text, null),
        englishLanguage: d.language,
        englishAsks: d.asks,
        englishLevel: d.level,
      });
    }
    expect(jobLanguageFacts(en, null).jdLanguage).toBe("en");
  });

  it("sin texto ni idioma declarado, todo null y no pide inglés", () => {
    expect(jobLanguageFacts(null, null)).toEqual({
      jdLanguage: null,
      englishLanguage: null,
      englishAsks: false,
      englishLevel: null,
    });
  });

  it("el mercado da lo mismo con los datos persistidos que leyendo el texto", () => {
    const now = "2026-11-03T12:00:00.000Z";
    const jobs = TEXTS.map((jdText, i) => ({
      id: `j${i}`,
      title: "Aviso",
      seniority: null,
      lang: i % 3 === 0 ? "es" : null,
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      modality: "remoto",
      countriesAllowed: null,
      locationRaw: "Remoto",
      sourceKind: "jobicy",
      publishedAt: now,
      jdText,
    }));
    const input = { role: "abogacia" as const, jobs, skills: [], poolUpdatedAt: now, now };
    const fromText = buildCareerMarket(input);
    const persisted = {
      ...input,
      jobs: jobs.map((j) => ({ ...j, jdText: null, language: jobLanguageFacts(j.jdText, j.lang) })),
    };
    expect(buildCareerMarket(persisted)).toEqual(fromText);
  });
});
