import { describe, expect, it } from "vitest";
import {
  experienceCardSchema,
  initialProfileAgentState,
  parseProfileAgentState,
  profileCardDecisionSchema,
  profileGapAnswerSchema,
  profileGapCardSchema,
  profileGuideAnswersSchema,
  profileGuideCardSchema,
  profileReadCardSchema,
  profileReadProposalSchema,
} from "./schemas";

const exp = {
  kind: "experience",
  id: "exp:0",
  organization: "Empresa A",
  title: "Analista",
  startMonth: "2021-03",
  endMonth: null,
  isCurrent: true,
  bullets: [],
};
const HISTORY_ID = "11111111-1111-4111-8111-111111111111";

describe("tarjetas de lectura", () => {
  it("acepta experiencia, estudio, skill e idioma", () => {
    const cards = [
      exp,
      {
        kind: "education",
        id: "edu:0",
        institution: "Universidad A",
        title: "Lic. en X",
        startMonth: "2015-03",
        endMonth: "2019-12",
      },
      {
        kind: "education",
        id: "edu:1",
        institution: "Instituto B",
        title: "Curso de X",
        startMonth: null,
        endMonth: null,
      },
      { kind: "skill", id: "skill:0", name: "SQL", slug: "sql", level: 2, verified: true },
      { kind: "skill", id: "skill:1", name: "Oratoria", slug: null, level: null, verified: false },
      { kind: "language", id: "lang:0", name: "Inglés", level: "B2" },
    ];
    for (const c of cards) expect(profileReadCardSchema.safeParse(c).success).toBe(true);
  });

  it("estricto: una clave de más (dato sensible) falla", () => {
    for (const extra of [{ age: 31 }, { maritalStatus: "casada" }, { photo: "x" }, { dni: "1" }]) {
      expect(profileReadCardSchema.safeParse({ ...exp, ...extra }).success).toBe(false);
    }
  });

  it("lo que el CV no dice queda vacío: fechas, nivel e idioma admiten null", () => {
    expect(
      profileReadCardSchema.safeParse({
        ...exp,
        startMonth: null,
        endMonth: null,
        isCurrent: false,
      }).success,
    ).toBe(true);
    expect(
      profileReadCardSchema.safeParse({
        kind: "language",
        id: "lang:1",
        name: "Portugués",
        level: null,
      }).success,
    ).toBe(true);
  });

  it("valida fechas como la carga manual", () => {
    expect(experienceCardSchema.safeParse({ ...exp, startMonth: "2021-13" }).success).toBe(false);
    expect(
      experienceCardSchema.safeParse({ ...exp, isCurrent: false, endMonth: "2020-01" }).success,
    ).toBe(false); // fin anterior al inicio
    expect(
      experienceCardSchema.safeParse({
        ...exp,
        startMonth: null,
        isCurrent: false,
        endMonth: "2020-01",
      }).success,
    ).toBe(false); // fin sin inicio
    expect(experienceCardSchema.safeParse({ ...exp, endMonth: "2022-01" }).success).toBe(false); // actual con fin
  });

  it("sin links ni emails, con topes de largo y de viñetas", () => {
    expect(
      experienceCardSchema.safeParse({ ...exp, organization: "https://x.example" }).success,
    ).toBe(false);
    expect(experienceCardSchema.safeParse({ ...exp, title: "a@example.com" }).success).toBe(false);
    expect(experienceCardSchema.safeParse({ ...exp, title: "x".repeat(121) }).success).toBe(false);
    expect(
      experienceCardSchema.safeParse({ ...exp, bullets: Array(7).fill("Hice algo") }).success,
    ).toBe(false);
    expect(experienceCardSchema.safeParse({ ...exp, bullets: ["x".repeat(221)] }).success).toBe(
      false,
    );
  });

  it("rechaza saltos de línea, caracteres de control e invisibles en los campos", () => {
    for (const bad of ["Ana\nlista", "Ana\tlista", "Ana\u0000", "Ana​lista", "Ana‮lista"]) {
      expect(experienceCardSchema.safeParse({ ...exp, title: bad }).success).toBe(false);
      expect(experienceCardSchema.safeParse({ ...exp, bullets: [bad] }).success).toBe(false);
    }
    expect(experienceCardSchema.safeParse({ ...exp, title: "Analista de datos" }).success).toBe(
      true,
    );
  });

  it("skill: nivel solo 1 a 3 y nombre de 2 a 40", () => {
    const skill = {
      kind: "skill",
      id: "skill:0",
      name: "SQL",
      slug: "sql",
      level: 2,
      verified: true,
    };
    expect(profileReadCardSchema.safeParse({ ...skill, level: 0 }).success).toBe(false);
    expect(profileReadCardSchema.safeParse({ ...skill, level: 4 }).success).toBe(false);
    expect(profileReadCardSchema.safeParse({ ...skill, name: "x" }).success).toBe(false);
    expect(profileReadCardSchema.safeParse({ ...skill, name: "x".repeat(41) }).success).toBe(false);
  });

  it("propuesta: puestos sugeridos validados y tope de tarjetas", () => {
    const base = { cards: [exp], suggestedRoles: [], dropped: 0 };
    expect(profileReadProposalSchema.safeParse(base).success).toBe(true);
    expect(
      profileReadProposalSchema.safeParse({ ...base, suggestedRoles: ["no_es_un_puesto"] }).success,
    ).toBe(false);
    expect(
      profileReadProposalSchema.safeParse({ ...base, cards: Array(61).fill(exp) }).success,
    ).toBe(false);
  });

  it("decisión: aceptar o descartar, con la tarjeta editada opcional", () => {
    expect(profileCardDecisionSchema.safeParse({ id: "exp:0", decision: "discard" }).success).toBe(
      true,
    );
    expect(
      profileCardDecisionSchema.safeParse({ id: "exp:0", decision: "accept", card: exp }).success,
    ).toBe(true);
    expect(profileCardDecisionSchema.safeParse({ id: "exp:0", decision: "maybe" }).success).toBe(
      false,
    );
  });
});

describe("huecos", () => {
  it("respuesta: texto, «no tengo» y nivel", () => {
    expect(
      profileGapAnswerSchema.safeParse({
        kind: "text",
        key: `${HISTORY_ID}:achievement`,
        text: "Bajé los reclamos un 20%",
      }).success,
    ).toBe(true);
    expect(
      profileGapAnswerSchema.safeParse({ kind: "none", key: `${HISTORY_ID}:achievement` }).success,
    ).toBe(true);
    expect(
      profileGapAnswerSchema.safeParse({ kind: "level", key: "skill:sql:skill_level", level: 3 })
        .success,
    ).toBe(true);
    expect(profileGapAnswerSchema.safeParse({ kind: "text", key: "k", text: "   " }).success).toBe(
      false,
    );
    expect(
      profileGapAnswerSchema.safeParse({ kind: "text", key: "k", text: "x".repeat(1001) }).success,
    ).toBe(false);
    expect(profileGapAnswerSchema.safeParse({ kind: "level", key: "k", level: 5 }).success).toBe(
      false,
    );
  });

  it("tarjetas de cambio: una por campo, con historyId uuid", () => {
    const key = `${HISTORY_ID}:achievement`;
    expect(
      profileGapCardSchema.safeParse({
        field: "achievement",
        key,
        historyId: HISTORY_ID,
        bullet: "Reduje los reclamos",
      }).success,
    ).toBe(true);
    expect(
      profileGapCardSchema.safeParse({
        field: "achievement",
        key,
        historyId: "no-uuid",
        bullet: "x",
      }).success,
    ).toBe(false);
    expect(
      profileGapCardSchema.safeParse({
        field: "duties",
        key,
        historyId: HISTORY_ID,
        bullets: [],
      }).success,
    ).toBe(false);
    expect(
      profileGapCardSchema.safeParse({
        field: "dates",
        key,
        historyId: HISTORY_ID,
        startMonth: "2020-01",
        endMonth: "2019-01",
        isCurrent: false,
      }).success,
    ).toBe(false);
    expect(
      profileGapCardSchema.safeParse({
        field: "skill_level",
        key,
        name: "SQL",
        slug: "sql",
        level: 2,
      }).success,
    ).toBe(true);
    expect(profileGapCardSchema.safeParse({ field: "age", key, value: 30 }).success).toBe(false);
  });
});

describe("guía", () => {
  it("respuestas: puestos del catálogo, modalidades, país ISO, topes", () => {
    expect(profileGuideAnswersSchema.safeParse({}).success).toBe(true);
    expect(
      profileGuideAnswersSchema.safeParse({
        modalities: ["remoto"],
        country: "AR",
        maxYearsHard: 5,
        salaryFloorUsdMonthly: null,
        avoid: ["director"],
      }).success,
    ).toBe(true);
    expect(profileGuideAnswersSchema.safeParse({ roles: ["no_es_un_puesto"] }).success).toBe(false);
    expect(profileGuideAnswersSchema.safeParse({ modalities: ["en_la_luna"] }).success).toBe(false);
    expect(profileGuideAnswersSchema.safeParse({ country: "ZZ" }).success).toBe(false);
    expect(profileGuideAnswersSchema.safeParse({ salaryFloorUsdMonthly: -1 }).success).toBe(false);
    expect(profileGuideAnswersSchema.safeParse({ avoid: Array(11).fill("a") }).success).toBe(false);
  });

  it("la tarjeta «skill a reforzar» exige evidencia de datos: sin ofertas no existe", () => {
    const base = { kind: "reinforce", slug: "sql", name: "SQL" };
    expect(
      profileGuideCardSchema.safeParse({ ...base, evidence: { offersAsking: 12, poolSize: 40 } })
        .success,
    ).toBe(true);
    expect(profileGuideCardSchema.safeParse(base).success).toBe(false);
    expect(
      profileGuideCardSchema.safeParse({ ...base, evidence: { offersAsking: 0, poolSize: 40 } })
        .success,
    ).toBe(false);
  });

  it("las tarjetas de la guía no tienen campo de texto libre (no hay dónde prometer nada)", () => {
    const withMessage = {
      kind: "alert_keywords",
      portal: "linkedin",
      language: "es",
      keywords: ["analista"],
      message: "Te van a llamar",
    };
    expect(profileGuideCardSchema.safeParse(withMessage).success).toBe(false);
    expect(
      profileGuideCardSchema.safeParse({
        kind: "alert_keywords",
        portal: "linkedin",
        language: "es",
        keywords: ["analista"],
      }).success,
    ).toBe(true);
    expect(
      profileGuideCardSchema.safeParse({
        kind: "alert_keywords",
        portal: "bumeran",
        language: "es",
        keywords: ["a"],
      }).success,
    ).toBe(false);
  });
});

describe("estado que viaja", () => {
  it("el inicial es válido y el estricto rechaza claves de más", () => {
    expect(parseProfileAgentState(initialProfileAgentState())).not.toBeNull();
    expect(
      parseProfileAgentState({ ...initialProfileAgentState(), cvText: "texto del CV" }),
    ).toBeNull();
    expect(parseProfileAgentState({ ...initialProfileAgentState(), stage: "hack" })).toBeNull();
    expect(parseProfileAgentState(null)).toBeNull();
  });
  it("no hay dónde llevar el texto del CV ni la charla", () => {
    const keys = Object.keys(initialProfileAgentState());
    expect(keys.sort()).toEqual(["gaps", "guide", "stage"]);
  });
});
