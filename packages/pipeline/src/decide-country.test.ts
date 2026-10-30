import { describe, expect, it } from "vitest";
import adversarial from "../../../evals/fixtures/adversarial.json";
import golden from "../../../evals/fixtures/golden.json";
import criteria from "../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "./criteria";
import { COUNTRY_ONLY_RULE, decide, type DecideContext } from "./decide";
import type { Evaluation } from "./evaluation";
import { prefilter } from "./prefilter";

const rules = criteria as CriteriaRules;

const base: Evaluation = {
  score: 8.5,
  confianza: "alta",
  years_required: 4,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "intermedio",
  tipo_empresa: "producto",
  paises_permitidos: null,
  match_fuerte: ["RAG"],
  gaps: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "ok",
  accion_sugerida: "aplicar",
  riesgos: [],
  years_domain: null,
  years_discipline: null,
};

const ctx = (
  jobLocation: NonNullable<DecideContext["jobLocation"]>,
  candidateCountry: string | null = "AR",
): DecideContext => ({ candidateCountry, jobLocation });

describe("decide(): aviso remoto limitado a otro país (H-1)", () => {
  it("lista de países sin el de la persona → bloqueador, descartar, location_ok «no»", () => {
    const d = decide(
      { ...base, location_ok: "riesgo" },
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["CA"] }),
    );
    expect(d.accion).toBe("descartar");
    expect(d.locationOk).toBe("no");
    expect(d.bloqueadores).toEqual(["aviso limitado a CA (no incluye tu país)"]);
    expect(d.adjustments).toContainEqual(
      expect.objectContaining({ rule: COUNTRY_ONLY_RULE, delta: 0 }),
    );
    expect(d.scoreFinal).toBe(8.5);
  });

  it("el modelo dijo «ok» y aun así bloquea: la regla es de código", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remoto (solo Canadá)", countriesAllowed: null }),
    );
    expect(d.accion).toBe("descartar");
    expect(d.bloqueadores).toHaveLength(1);
  });

  it("varios países ajenos", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["CA", "US"] }),
    );
    expect(d.bloqueadores).toEqual(["aviso limitado a CA, US (no incluye tu país)"]);
  });

  it("la lista incluye el país de la persona → no bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["CA", "AR"] }),
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.accion).toBe("aplicar");
  });

  it("la lista nombra una región que incluye su país (LATAM) → no bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["LATINOAMÉRICA"] }),
    );
    expect(d.bloqueadores).toEqual([]);
  });

  it("«*» (cualquier país) → no bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["*"] }),
    );
    expect(d.bloqueadores).toEqual([]);
  });

  it("el aviso dice que acepta su país en el texto de ubicación → no bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Canada or Argentina", countriesAllowed: ["CA"] }),
    );
    expect(d.bloqueadores).toEqual([]);
  });

  it("el aviso dice que acepta su región en la JD (aun con un huso horario) → no bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({
        modality: "remoto",
        locationRaw: "Remote (Canada)",
        countriesAllowed: null,
        jdText:
          "We are a Toronto company.\nWe also hire in LATAM with EST overlap.\nYou will build dashboards.",
      }),
    );
    expect(d.bloqueadores).toEqual([]);
  });

  it("la JD nombra países ajenos pero no el suyo ni una región que lo incluya → bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({
        modality: "remoto",
        locationRaw: "Remote (Canada)",
        countriesAllowed: null,
        jdText: "Open to candidates in Canada and the US.\nEST hours.",
      }),
    );
    expect(d.accion).toBe("descartar");
    expect(d.bloqueadores).toEqual(["aviso limitado a CA (no incluye tu país)"]);
  });

  it("falla abierto: ubicación que no se entiende, modalidad no remota o sin país de la persona", () => {
    const unknown = ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: null });
    expect(decide(base, rules, unknown).bloqueadores).toEqual([]);
    const hybrid = ctx({ modality: "hibrido", locationRaw: "Toronto", countriesAllowed: ["CA"] });
    expect(decide(base, rules, hybrid).bloqueadores).toEqual([]);
    const noCountry = ctx(
      { modality: "remoto", locationRaw: "Remote", countriesAllowed: ["CA"] },
      null,
    );
    expect(decide(base, rules, noCountry).bloqueadores).toEqual([]);
    expect(decide(base, rules, { jobLocation: unknown.jobLocation }).bloqueadores).toEqual([]);
  });

  it("un huso horario en la ubicación (US time zones) no es un país: falla abierto", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote, US time zones", countriesAllowed: null }),
    );
    expect(d.bloqueadores).toEqual([]);
  });

  it("no duplica con la residencia exigida del prefiltro ni con un bloqueador de país del modelo", () => {
    const place = ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["CA"] });
    const withResidency = decide(base, rules, {
      ...place,
      prefilterFlags: ["residencia_exigida:CA"],
    });
    expect(withResidency.bloqueadores).toEqual(["residencia exigida en CA"]);
    const withModel = decide(
      { ...base, bloqueadores_duros: ["país excluido: Canadá"] },
      rules,
      place,
    );
    expect(withModel.bloqueadores).toEqual(["país excluido: Canadá"]);
    expect(withModel.accion).toBe("descartar");
  });

  it("el perfil de otro país: para una persona de CA el mismo aviso no bloquea", () => {
    const d = decide(
      base,
      rules,
      ctx({ modality: "remoto", locationRaw: "Remote", countriesAllowed: ["CA"] }, "CA"),
    );
    expect(d.bloqueadores).toEqual([]);
  });
});

type GoldenJob = {
  id: number;
  titulo: string;
  empresa: string;
  modalidad: string;
  ubicacion_raw: string;
  paises: string[] | null;
  badges: string[];
  candidatos: number | null;
  jd?: string;
  anos: number | null;
  human_score_match: number | null;
  human_blockers: string[];
  human_risks: string[];
  human_location_ok: Evaluation["location_ok"];
  accion: string;
};

/** La evaluación de referencia: lo que el humano anotó, como si el modelo lo hubiera devuelto. */
function reference(j: GoldenJob): Evaluation {
  return {
    ...base,
    score: j.human_score_match ?? 5,
    years_required: j.anos,
    location_ok: j.human_location_ok,
    modalidad: j.modalidad as Evaluation["modalidad"],
    bloqueadores_duros: j.human_blockers,
    riesgos: j.human_risks,
  };
}

describe("regla de país sobre el golden y los adversariales (sin LLM)", () => {
  const all = [...(golden.jobs as GoldenJob[]), ...(adversarial.jobs as unknown as GoldenJob[])];

  it("solo cambia la decisión del caso H-1 (id 37): el resto queda idéntico", () => {
    const changed: number[] = [];
    for (const j of all) {
      const pre = prefilter(
        {
          title: j.titulo,
          companyRaw: j.empresa,
          locationRaw: j.ubicacion_raw,
          modality: j.modalidad as "remoto" | "hibrido" | "presencial" | "desconocida",
          badges: j.badges,
          candidatesCount: j.candidatos,
          countriesAllowed: null,
          jdText: j.jd ?? null,
        },
        rules,
        { userCountry: "AR" },
      );
      if (!pre.pass) continue;
      const before: DecideContext = { titleCap: pre.cap, prefilterFlags: pre.flags };
      const after: DecideContext = {
        ...before,
        candidateCountry: "AR",
        jobLocation: {
          modality: j.modalidad,
          locationRaw: j.ubicacion_raw,
          countriesAllowed: j.paises,
          jdText: j.jd ?? null,
        },
      };
      const a = decide(reference(j), rules, before);
      const b = decide(reference(j), rules, after);
      if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(j.id);
    }
    expect(changed).toEqual([37]);
  });

  it("el caso H-1 se descarta por la regla de país, con datos inventados", () => {
    const j = all.find((x) => x.id === 37)!;
    expect(j.empresa).toMatch(/^Empresa /);
    const d = decide(reference(j), rules, {
      candidateCountry: "AR",
      jobLocation: {
        modality: j.modalidad,
        locationRaw: j.ubicacion_raw,
        countriesAllowed: j.paises,
        jdText: j.jd ?? null,
      },
    });
    expect(d.accion).toBe(j.accion);
    expect(d.accion).toBe("descartar");
    expect(d.bloqueadores).toEqual(["aviso limitado a CA (no incluye tu país)"]);
  });

  it("es determinística: dos corridas dan lo mismo", () => {
    const j = all.find((x) => x.id === 37)!;
    const c: DecideContext = {
      candidateCountry: "AR",
      jobLocation: {
        modality: j.modalidad,
        locationRaw: j.ubicacion_raw,
        countriesAllowed: j.paises,
      },
    };
    expect(decide(reference(j), rules, c)).toEqual(decide(reference(j), rules, c));
  });
});
