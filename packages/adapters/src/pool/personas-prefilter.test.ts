import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criteriaFromOnboarding, prefilter } from "@job-search-os/pipeline";
import { jdLanguageFor } from "../ingest/ingest-job";
import { parsePersona, type Persona } from "./explain";
import { poolExtraDiscard } from "./select";

/**
 * Evals deterministas del prefiltro del pool, sin LLM ni base (R4): cada persona ficticia de
 * `personas/*.json` contra cada aviso inventado de `personas/avisos-prefiltro.json`.
 *
 * Arma las reglas y las preferencias como `personaProfile` (explain.ts) y llama al prefiltro con los
 * mismos campos que `selectPoolCandidates` (select.ts), más el descarte propio del pool
 * (`poolExtraDiscard`: ubicación y nivel). Diferencias con el pool real:
 *  - no hay consulta (ventanas de fecha, `role_hints`, copias, tope de 300): solo se mide el prefiltro;
 *  - `levelBySkill` no se arma (solo afecta al pre-score, no a pasa/descarta);
 *  - `select.ts` NO le pasa `jdText` al prefiltro; acá tampoco, para medir lo que el pool hace de verdad.
 *
 * Las expectativas están escritas a mano, por aviso, con el motivo. Los casos que parecen un defecto
 * del prefiltro (carril rojo, lo decide Mauro) no se arreglan acá: van en el `describe` de hallazgos
 * con `it.fails` y la expectativa que debería cumplirse.
 */

const PERSONAS_DIR = new URL("./personas/", import.meta.url);

type Aviso = {
  id: string;
  title: string;
  companyRaw: string;
  locationRaw: string | null;
  modality: "remoto" | "hibrido" | "presencial" | null;
  countriesAllowed: string[] | null;
  candidatesCount: number | null;
  lang: string | null;
  jdText: string | null;
};

const avisos: Aviso[] = JSON.parse(
  readFileSync(new URL("avisos-prefiltro.json", PERSONAS_DIR), "utf8"),
);

const personas = new Map<string, Persona>(
  readdirSync(PERSONAS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "avisos-prefiltro.json")
    .sort()
    .map((f) => {
      const r = parsePersona(JSON.parse(readFileSync(new URL(f, PERSONAS_DIR), "utf8")));
      if (!r.ok) throw new Error(`${f}: ${r.error}`);
      return [f.replace(/\.json$/, ""), r.persona] as const;
    }),
);
const NOMBRES = [...personas.keys()];

/**
 * Resultado como texto legible: "pasa", "pasa [flags]" o "descarta <motivo>".
 * TODO: copia a mano la llamada de `selectPoolCandidates` (`select.ts`). Si esa llamada cambia, esta
 * tabla mide algo que ya no existe. Lo sano es extraer una función pura compartida (cambio rojo).
 */
function evaluar(persona: Persona, job: Aviso): string {
  const rules = criteriaFromOnboarding({
    salaryFloorUsd: persona.salaryFloorUsd,
    maxWeeklyHours: persona.maxWeeklyHours,
  });
  // Igual que personaProfile: jobLanguages solo si la persona lo declara; sin acceptedModalities ni ciudad
  const jobLanguages = persona.jobLanguages ?? undefined;
  const pre = prefilter(
    {
      title: job.title,
      companyRaw: job.companyRaw,
      locationRaw: job.locationRaw,
      modality: job.modality,
      candidatesCount: job.candidatesCount,
      countriesAllowed: job.countriesAllowed,
      jdLanguage: jobLanguages ? jdLanguageFor(jobLanguages, job.jdText, job.lang) : null,
    },
    rules,
    {
      userCountry: persona.locationCountry,
      remoteOnly: persona.remoteOnly,
      jobLanguages,
      targetRoles: persona.targetRoles,
    },
  );
  if (!pre.pass) return `descarta ${pre.reason}`;
  const extra = poolExtraDiscard(job, {
    country: persona.locationCountry,
    yearsTotal: persona.yearsTotal,
  });
  if (extra) return `descarta ${extra.reason}`;
  const flags = [...pre.flags, ...(pre.cap !== null ? [`title_cap:${pre.cap}`] : [])];
  return flags.length ? `pasa [${flags.join("; ")}]` : "pasa";
}

const avisoPorId = (id: string): Aviso => {
  const a = avisos.find((x) => x.id === id);
  if (!a) throw new Error(`aviso inexistente: ${id}`);
  return a;
};

const resultados = (id: string): Record<string, string> =>
  Object.fromEntries(NOMBRES.map((n) => [n, evaluar(personas.get(n)!, avisoPorId(id))]));

const AR = [
  "lucia",
  "ai-junior",
  "product-manager",
  "product-owner",
  "project-manager",
  "product-marketing",
  "data-engineer",
  "solutions-engineer",
  "ventas-b2b",
  "atencion-cliente",
  "finanzas-contabilidad",
  "asistencia-operaciones",
];

type Excepcion = { porque: string; personas: readonly string[]; esperado: string };
type Fila = { aviso: string; base: string; porque: string; excepciones?: Excepcion[] };

const pasa = (...flags: string[]) => (flags.length ? `pasa [${flags.join("; ")}]` : "pasa");
const descarta = (motivo: string) => `descarta ${motivo}`;

const TABLA: Fila[] = [
  {
    aviso: "backend-latam",
    base: pasa("location_risk"),
    porque:
      '"Remoto - LATAM" no nombra el país de nadie: riesgo de ubicación, nunca descarte; LATAM sí incluye a los seis países',
  },
  {
    aviso: "backend-solo-eeuu",
    base: descarta("ubicacion"),
    porque: "solo habilita EE. UU.: el pool descarta por ubicación a quien vive en otro país",
    excepciones: [
      {
        porque: "el aviso está en inglés y la persona solo acepta español: el idioma corta antes",
        personas: ["customer-success-solo-es"],
        esperado: descarta("idioma_no_aceptado"),
      },
    ],
  },
  {
    aviso: "analista-presencial-cordoba",
    base: descarta("modalidad_no_remota"),
    porque: "presencial y la persona acepta solo remoto: bloqueador de modalidad",
    excepciones: [
      {
        porque:
          "acepta las tres modalidades (pasa el prefiltro) pero el aviso habilita solo Argentina y vive en Colombia",
        personas: ["qa"],
        esperado: descarta("ubicacion"),
      },
    ],
  },
  {
    aviso: "qa-hibrido-bogota",
    base: descarta("modalidad_no_remota"),
    porque: "híbrido y la persona acepta solo remoto",
    excepciones: [
      {
        porque: "acepta las tres modalidades y vive en Colombia: pasa con el flag de modalidad",
        personas: ["qa"],
        esperado: pasa("modalidad_no_remota"),
      },
    ],
  },
  {
    aviso: "csm-ingles-mundial",
    base: pasa(),
    porque:
      "mundial (countriesAllowed *), sin bloqueadores; el idioma no se filtra si no se declara",
    excepciones: [
      {
        porque: "aviso en inglés y la persona solo acepta español",
        personas: ["customer-success-solo-es"],
        esperado: descarta("idioma_no_aceptado"),
      },
    ],
  },
  {
    aviso: "cs-specialist-es-mundial",
    base: pasa(),
    porque: "mundial y en español: pasa para todas, también para la persona «solo español»",
  },
  {
    aviso: "head-of-engineering",
    base: descarta("titulo_blocklist"),
    porque: '"head of" está en la blocklist de títulos por defecto',
  },
  {
    aviso: "staff-engineer",
    base: descarta("nivel"),
    porque:
      "título Staff y la persona tiene menos de 5 años: descarte propio del pool (nivel), no del prefiltro",
    excepciones: [
      {
        porque: "5 o más años: el título Staff no la descarta",
        personas: ["rrhh-it", "qa"],
        esperado: pasa(),
      },
    ],
  },
  {
    aviso: "abogado",
    base: descarta("disciplina_distinta"),
    porque: '"abogad" es otro oficio y el título no tiene señal IT',
  },
  {
    aviso: "contable-matricula-uruguay",
    base: descarta("licencia_profesional"),
    porque: "exige matrícula profesional de Uruguay y la persona no es de Uruguay",
    excepciones: [
      {
        porque:
          "la matrícula es de su país: no descarta, queda el flag para el evaluador (y el riesgo de «Remoto» sin país)",
        personas: ["diseno-ux"],
        esperado: pasa("location_risk", "licencia_profesional:matricula profesional"),
      },
    ],
  },
  {
    aviso: "contable-cpa-eeuu",
    base: descarta("licencia_profesional"),
    porque:
      "exige CPA con licencia para ejercer en EE. UU.: licencia de otro país, también para finanzas",
  },
  {
    aviso: "contador-matriculado-argentina",
    base: descarta("licencia_profesional"),
    porque: "«Contador Público Matriculado» en un aviso de Argentina: la licencia es argentina",
    excepciones: [
      {
        porque: "personas de Argentina: la ubicación hace propia la matrícula, solo queda el flag",
        personas: AR,
        esperado: pasa("licencia_profesional:contador publico matriculado"),
      },
    ],
  },
  {
    aviso: "residencia-canada-ubicacion",
    base: descarta("ubicacion"),
    porque:
      "la ubicación dice que hay que estar en Canadá: el prefiltro suma riesgo y el pool descarta por ubicación",
  },
  {
    aviso: "backend-brasil-peru",
    base: descarta("ubicacion"),
    porque: "countriesAllowed BR y PE: ninguna de las seis personas vive ahí",
  },
  {
    aviso: "qa-junior-lista-paises",
    base: pasa(),
    porque:
      "lista explícita con AR, CL, CO, MX y UY: el país de la persona está incluido, sin riesgo (a pesar de «LATAM»)",
  },
  {
    aviso: "ux-muchos-candidatos",
    base: pasa("many_candidates"),
    porque: "250 candidatos (desde 100) es riesgo, no descarte",
  },
  {
    aviso: "ml-pytorch",
    base: descarta("disciplina_distinta"),
    porque:
      '"pytorch" está en ml_engineer_keywords: ML engineer descarta siempre, incluso a ai_engineer',
  },
  {
    aviso: "growth-manager",
    base: descarta("disciplina_distinta"),
    porque: '"growth" es de otra disciplina para quien no la tiene como oficio propio',
    excepciones: [
      {
        porque: "growth es oficio propio de marketing_digital, product_manager y product_marketing",
        personas: ["marketing-digital", "product-manager", "product-marketing"],
        esperado: pasa(),
      },
    ],
  },
  {
    aviso: "project-manager-pmp",
    base: descarta("disciplina_distinta"),
    porque: '"pmp" y "project manager" son de otra disciplina salvo en las carreras de gestión',
    excepciones: [
      {
        porque:
          "oficio propio de product_manager, product_owner y project_manager (Lucía incluye project_manager)",
        personas: ["product-manager", "product-owner", "project-manager", "lucia"],
        esperado: pasa(),
      },
    ],
  },
  {
    aviso: "vendedor",
    base: descarta("disciplina_distinta"),
    porque: '"vendedor" es otro oficio sin señal IT',
    excepciones: [
      {
        porque: "vendedor es el oficio propio de ventas_b2b",
        personas: ["ventas-b2b"],
        esperado: pasa(),
      },
    ],
  },
  {
    aviso: "atencion-callcenter",
    base: descarta("disciplina_distinta"),
    porque:
      '"atención al cliente" es otro oficio (también para customer_success, por decisión del plan)',
    excepciones: [
      {
        porque: "atención al cliente es el oficio propio de atencion_cliente",
        personas: ["atencion-cliente"],
        esperado: pasa(),
      },
    ],
  },
  {
    aviso: "backend-hibrido-titulo",
    base: descarta("modalidad_no_remota"),
    porque: "el título dice «(Híbrido)» aunque la fuente no traiga modalidad: gana el título",
    excepciones: [
      {
        porque: "acepta las tres modalidades y vive en Colombia",
        personas: ["qa"],
        esperado: pasa("modalidad_no_remota"),
      },
    ],
  },
];

describe("personas × avisos del prefiltro (sin LLM, sin base)", () => {
  it("hay 18 personas y entre 15 y 25 avisos, con ids únicos", () => {
    expect(NOMBRES).toHaveLength(18);
    expect(avisos.length).toBeGreaterThanOrEqual(15);
    expect(avisos.length).toBeLessThanOrEqual(25);
    expect(new Set(avisos.map((a) => a.id)).size).toBe(avisos.length);
  });

  it("las excepciones nombran personas que existen", () => {
    for (const f of TABLA)
      for (const e of f.excepciones ?? [])
        for (const p of e.personas) expect(NOMBRES, `${f.aviso}: ${p}`).toContain(p);
  });

  it("los avisos son ficticios: empresas «Empresa X» y sin datos de contacto", () => {
    for (const a of avisos) {
      expect(a.companyRaw).toMatch(/^Empresa [A-Z]$/);
      expect(JSON.stringify(a)).not.toMatch(/@|https?:|www\./i);
    }
  });

  describe.each(TABLA)("$aviso", (fila) => {
    it(fila.porque, () => {
      const esperado = Object.fromEntries(
        NOMBRES.map((n) => [
          n,
          fila.excepciones?.find((e) => e.personas.includes(n))?.esperado ?? fila.base,
        ]),
      );
      expect(resultados(fila.aviso)).toEqual(esperado);
    });

    for (const e of fila.excepciones ?? []) {
      it(`excepción: ${e.porque}`, () => {
        for (const p of e.personas) {
          expect(evaluar(personas.get(p)!, avisoPorId(fila.aviso)), p).toBe(e.esperado);
        }
      });
    }
  });

  it("todo aviso de la tabla está cubierto, salvo los de hallazgos", () => {
    const enHallazgos = [
      "agente-atencion-cliente",
      "contable-matricula-solo-en-jd",
      "residencia-solo-en-jd",
    ];
    const cubiertos = new Set([...TABLA.map((f) => f.aviso), ...enHallazgos]);
    expect(avisos.map((a) => a.id).filter((id) => !cubiertos.has(id))).toEqual([]);
  });

  it("una persona solo español no recibe avisos en inglés, pero sí los que no se pueden detectar", () => {
    const soloEs = personas.get("customer-success-solo-es")!;
    expect(soloEs.jobLanguages).toEqual(["es"]);
    // Sin texto ni idioma declarado no se sabe: pasa (el prefiltro falla abierto ante la duda)
    const sinTexto: Aviso = { ...avisoPorId("cs-specialist-es-mundial"), jdText: null, lang: null };
    expect(evaluar(soloEs, sinTexto)).toBe("pasa");
    // Con `lang` declarado alcanza, aunque no haya texto
    expect(evaluar(soloEs, { ...sinTexto, lang: "en" })).toBe(descarta("idioma_no_aceptado"));
  });

  it("el resumen de resultados por tipo no cambia (para detectar regresiones del conjunto)", () => {
    const resumen: Record<string, number> = {};
    for (const a of avisos) {
      for (const n of NOMBRES) {
        const r = evaluar(personas.get(n)!, a);
        const clave = r.startsWith("pasa") ? "pasa" : r;
        resumen[clave] = (resumen[clave] ?? 0) + 1;
      }
    }
    expect(resumen).toMatchInlineSnapshot(`
      {
        "descarta disciplina_distinta": 99,
        "descarta idioma_no_aceptado": 2,
        "descarta licencia_profesional": 41,
        "descarta modalidad_no_remota": 51,
        "descarta nivel": 16,
        "descarta titulo_blocklist": 18,
        "descarta ubicacion": 54,
        "pasa": 169,
      }
    `);
  });
});

/**
 * Hallazgos: resultados que parecen un defecto del prefiltro o de cómo lo llama el pool. NO se
 * arreglan acá (carril rojo: decide Mauro). Cada `it.fails` escribe lo que debería pasar; si algún
 * día se corrige el código, el test empieza a pasar y `it.fails` avisa que hay que pasarlo a la tabla.
 */
describe("hallazgos (posibles defectos, sin arreglar)", () => {
  const sinAtencion = NOMBRES.filter((n) => n !== "atencion-cliente");

  // prefilter.ts: AI_TITLE incluye «agente», que cuenta como señal IT (hasItSignal) y saltea NON_IT_TITLE
  it.fails(
    "H1: «Agente de Atención al Cliente» debería descartarse como el mismo aviso sin «Agente»",
    () => {
      const esperado = Object.fromEntries(
        sinAtencion.map((n) => [n, descarta("disciplina_distinta")]),
      );
      const real = Object.fromEntries(
        sinAtencion.map((n) => [
          n,
          evaluar(personas.get(n)!, avisoPorId("agente-atencion-cliente")),
        ]),
      );
      expect(real).toEqual(esperado);
    },
  );

  // select.ts no pasa `jdText` al prefiltro: la licencia que solo figura en la JD no se detecta en el pool
  it.fails(
    "H2: matrícula de Uruguay solo en el texto de la JD debería descartar a quien no es de Uruguay",
    () => {
      const otras = NOMBRES.filter((n) => n !== "diseno-ux");
      const real = Object.fromEntries(
        otras.map((n) => [
          n,
          evaluar(personas.get(n)!, avisoPorId("contable-matricula-solo-en-jd")),
        ]),
      );
      expect(real).toEqual(
        Object.fromEntries(otras.map((n) => [n, descarta("licencia_profesional")])),
      );
    },
  );

  // Idem H2 para residencia exigida: el texto de la JD no llega, queda solo location_risk de «Remoto»
  it.fails(
    "H3: «Debés residir en Canadá» solo en la JD debería sumar el flag residencia_exigida",
    () => {
      for (const n of NOMBRES) {
        const r = evaluar(personas.get(n)!, avisoPorId("residencia-solo-en-jd"));
        expect(r, n).toBe(pasa("location_risk", "residencia_exigida:CA"));
      }
    },
  );

  it("H2/H3 documentan el estado actual: sin jdText, esos dos avisos pasan solo con location_risk", () => {
    for (const id of ["contable-matricula-solo-en-jd", "residencia-solo-en-jd"]) {
      for (const n of NOMBRES)
        expect(evaluar(personas.get(n)!, avisoPorId(id)), `${id}/${n}`).toBe(pasa("location_risk"));
    }
  });

  it("H1 documenta el estado actual: con «Agente» en el título pasan todas las personas", () => {
    for (const n of NOMBRES) {
      expect(evaluar(personas.get(n)!, avisoPorId("agente-atencion-cliente")), n).toBe(pasa());
    }
  });

  it("sanidad: con jdText el prefiltro sí detecta lo que el pool no ve (H2/H3 no son culpa del detector)", () => {
    const persona = personas.get("lucia")!;
    const rules = criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null });
    const opts = {
      userCountry: persona.locationCountry,
      remoteOnly: true,
      targetRoles: persona.targetRoles,
    };
    const lic = avisoPorId("contable-matricula-solo-en-jd");
    expect(
      prefilter(
        { title: lic.title, locationRaw: lic.locationRaw, jdText: lic.jdText },
        rules,
        opts,
      ),
    ).toMatchObject({ pass: false, reason: "licencia_profesional" });
    const res = avisoPorId("residencia-solo-en-jd");
    const r = prefilter(
      { title: res.title, locationRaw: res.locationRaw, jdText: res.jdText },
      rules,
      opts,
    );
    expect(r).toMatchObject({ pass: true });
    expect(r.pass ? r.flags : []).toContain("residencia_exigida:CA");
  });
});
