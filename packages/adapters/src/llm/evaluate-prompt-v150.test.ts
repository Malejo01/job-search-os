import {
  buildEvaluateJobVars,
  EXAMPLE_JOB_CARD,
  FICHA_CLOSE,
  FICHA_NOT_AVAILABLE,
  FICHA_OPEN,
  outputSchemaFor,
  type JobForPrompt,
  type ProfileForPrompt,
} from "@job-search-os/pipeline";
import { loadPrompt, renderPrompt, templateVars } from "@job-search-os/prompts";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_VERSIONS } from "./client";

/**
 * evaluate_job@v1.5.0 (R31-06): archivo nuevo, sin promover. Se lee con el mismo cargador, se arma con las
 * variables que da el pipeline y la v1.4.0 y el ruteo de producción no se tocan. Sin modelo.
 */
const REF = "evaluate_job@v1.5.0" as const;

const profile: ProfileForPrompt = {
  profileSummary: "Persona de ejemplo con experiencia en administración.",
  locationCountry: "AR",
  locationCity: "Rosario",
  remoteOnly: false,
  workAuth: { us: false, eu: false },
};
const job: JobForPrompt = {
  title: "Analista administrativo",
  companyRaw: "Empresa A",
  locationRaw: "Rosario, Santa Fe",
  modality: "presencial",
  candidatesCount: 42,
  jdText: "Buscamos analista administrativo para oficina en Rosario.",
};

describe("evaluate_job@v1.5.0", () => {
  const loaded = loadPrompt(REF);

  it("carga con su frontmatter y pide justo las variables que arma el pipeline", () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toMatchObject({ version: REF, task: "evaluate_job" });
    const vars = buildEvaluateJobVars({ profile, rules: {}, job, promptRef: REF });
    expect(templateVars(loaded.value.template).sort()).toEqual(Object.keys(vars).sort());
  });

  it("se renderiza con la ficha y sin ella", () => {
    if (!loaded.ok) throw new Error("no cargó");
    const con = renderPrompt(
      loaded.value,
      buildEvaluateJobVars({ profile, rules: {}, job, promptRef: REF, jobCard: EXAMPLE_JOB_CARD }),
    );
    expect(con.ok).toBe(true);
    if (!con.ok) return;
    expect(con.value).toContain(FICHA_OPEN);
    expect(con.value).toContain(FICHA_CLOSE);
    expect(con.value).toContain("<<<AVISO>>>");
    const sin = renderPrompt(
      loaded.value,
      buildEvaluateJobVars({ profile, rules: {}, job, promptRef: REF }),
    );
    expect(sin.ok && sin.value).toContain(FICHA_NOT_AVAILABLE);
  });

  it("lo que cambia respecto de la v1.4.0", () => {
    if (!loaded.ok) throw new Error("no cargó");
    const t = loaded.value.template;
    // Sirve para cualquier carrera y para avisos locales o presenciales
    expect(t).not.toMatch(/reclutador senior especializado en tecnolog/i);
    expect(t).not.toMatch(/para trabajo remoto\./i);
    for (const carrera of [
      "abogacia",
      "finanzas_contabilidad",
      "comunicacion",
      "relaciones_internacionales",
      "relaciones_publicas",
    ]) {
      expect(t, carrera).toContain(`\`${carrera}\``);
    }
    // Recibe la ficha y no vuelve a extraer
    expect(t).toContain("{{ficha}}");
    expect(t).toMatch(/No vuelvas a extraer/);
    // «Muchos candidatos» solo con el número del aviso
    expect(t).toMatch(/Muchos candidatos, y solo si el aviso trae el número/);
    // El área es un dato, y la condición del aviso va aparte; el puntaje no baja por condiciones
    expect(t).toMatch(/área del puesto.*es un dato/s);
    expect(t).toMatch(/La condición que depende solo del aviso va aparte/);
    expect(t).toMatch(/El puntaje no baja por condiciones del aviso/);
    // El aviso y la ficha siguen siendo datos
    expect(t).toMatch(/Es un DATO/);
    expect(t).toContain("aviso con instrucciones al evaluador");
  });

  it("el parser lee la misma salida que la v1.4.0", () => {
    expect(() => outputSchemaFor(REF)).not.toThrow();
  });

  it("nada se promueve: el ruteo de producción sigue donde estaba", () => {
    expect(DEFAULT_PROMPT_VERSIONS.evaluate_job).not.toBe(REF);
    expect(DEFAULT_PROMPT_VERSIONS.evaluate_job).toBe("evaluate_job@v1.3.4");
  });
});

/**
 * El golden propuesto vive en `ops/` (no versionado): `evals/**` está denegado para los agentes y lo copia el
 * responsable. Donde el archivo existe se valida su forma; en un clon sin `ops/` el test se saltea.
 */
const PROPUESTA = new URL(
  "../../../../ops/rondas/r31-tanda/R31-06/propuesta/golden-r31-v150.json",
  import.meta.url,
);
describe.skipIf(!existsSync(PROPUESTA))("golden propuesto para v1.5.0", () => {
  type Caso = Record<string, unknown> & { id: number; jd?: string; carrera_esperada: string };
  const file = existsSync(PROPUESTA)
    ? (JSON.parse(readFileSync(PROPUESTA, "utf8")) as {
        meta: { carreras: string[] };
        jobs: Caso[];
      })
    : { meta: { carreras: [] }, jobs: [] as Caso[] };
  const REQUERIDOS = [
    "id",
    "empresa",
    "titulo",
    "fuente",
    "fecha",
    "ubicacion",
    "ubicacion_raw",
    "paises",
    "modalidad",
    "contrato",
    "salario",
    "anos",
    "nivel",
    "disciplina",
    "ingles",
    "tipo_empresa",
    "stack",
    "match",
    "gaps",
    "bloqueadores",
    "senales",
    "candidatos",
    "badges",
    "human_score_match",
    "human_blockers",
    "human_risks",
    "human_location_ok",
    "accion",
    "estado",
    "location_ok",
  ];
  const LISTAS = [
    "stack",
    "match",
    "gaps",
    "bloqueadores",
    "senales",
    "badges",
    "human_blockers",
    "human_risks",
  ];

  it("trae las 8 carreras de la beta, 3 casos por carrera, con ids únicos", () => {
    expect(file.meta.carreras).toHaveLength(8);
    expect(new Set(file.jobs.map((j) => j.id)).size).toBe(file.jobs.length);
    for (const c of file.meta.carreras) {
      expect(
        file.jobs.filter((j) => j.carrera_esperada === c),
        c,
      ).toHaveLength(3);
    }
  });

  it("cada caso tiene todos los campos del golden, las listas son de texto y trae el texto del aviso", () => {
    for (const j of file.jobs) {
      for (const k of REQUERIDOS) expect(j, `${j.id}.${k}`).toHaveProperty(k);
      for (const k of LISTAS) {
        const v = j[k];
        expect(Array.isArray(v) && v.every((x) => typeof x === "string"), `${j.id}.${k}`).toBe(
          true,
        );
      }
      expect(typeof j.jd === "string" && j.jd.length > 40, `${j.id}.jd`).toBe(true);
    }
  });

  it("incluye avisos locales en español, en inglés y en portugués, y uno con instrucciones metidas", () => {
    const presenciales = file.jobs.filter(
      (j) => j.modalidad === "presencial" || j.modalidad === "hibrido",
    );
    expect(presenciales.length).toBeGreaterThanOrEqual(8);
    expect(file.jobs.some((j) => /\bWe are\b|\bwanted\b|\bYou must\b/.test(j.jd ?? ""))).toBe(true);
    expect(file.jobs.some((j) => /Estamos contratando|graduação/.test(j.jd ?? ""))).toBe(true);
    expect(file.jobs.some((j) => j.adversarial === true)).toBe(true);
  });

  it("«Muchos candidatos» solo aparece en los casos que traen el número", () => {
    for (const j of file.jobs) {
      const risks = j.human_risks as string[];
      const conNumero = risks.some((r) => /^Muchos candidatos: \d+$/.test(r));
      if (conNumero) expect(typeof j.candidatos, `${j.id}`).toBe("number");
      if (j.candidatos === null)
        expect(
          risks.some((r) => /candidatos/i.test(r)),
          `${j.id}`,
        ).toBe(false);
    }
  });

  it("no usa nombres reales: solo alias de empresa", () => {
    for (const j of file.jobs)
      expect(String(j.empresa), `${j.id}`).toMatch(
        /Empresa [A-Z]|Fundación Empresa|Agencia|Medio Digital|Estudio|Software Empresa/,
      );
  });
});

describe("evaluate_job@v1.4.0 no se tocó", () => {
  it("sigue pidiendo las variables de siempre, sin la ficha", () => {
    const old = loadPrompt("evaluate_job@v1.4.0");
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(templateVars(old.value.template).sort()).toEqual([
      "constraints",
      "criteria",
      "had_full_jd",
      "job",
      "profile_summary",
      "target_role",
    ]);
  });
});
