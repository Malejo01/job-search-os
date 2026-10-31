import { describe, expect, it } from "vitest";
import fixture from "../../../../evals/fixtures/golden-carreras-beta.json";
import criteria from "../../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "../criteria";
import { prefilter } from "../prefilter/prefilter";
import { inferRoleHints, matchesRoleTitle, normalizeTitleText } from "./role-hints";
import type { RoleKey } from "./self-assessment";

type GoldenBetaJob = {
  id: number;
  carrera_esperada: RoleKey;
  tipo_caso: "buen_encaje" | "encaje_parcial" | "descarte";
  empresa: string;
  titulo: string;
  modalidad: string;
  ubicacion_raw: string;
  accion: "postular" | "guardar" | "descartar";
};

const jobs = fixture.jobs as GoldenBetaJob[];
const rules = criteria as CriteriaRules;

describe("golden-carreras-beta · catálogo y estructura", () => {
  it("contiene exactamente 48 casos (8 por cada una de las 6 carreras)", () => {
    expect(jobs).toHaveLength(48);
  });

  const careers: RoleKey[] = [
    "finanzas_contabilidad",
    "marketing_digital",
    "abogacia",
    "administracion_empresas",
    "comunicacion",
    "relaciones_internacionales",
  ];

  it.each(careers)("%s tiene 3 buen encaje, 2 encaje parcial y 3 descarte", (career) => {
    const careerJobs = jobs.filter((j) => j.carrera_esperada === career);
    expect(careerJobs).toHaveLength(8);

    const buenEncaje = careerJobs.filter((j) => j.tipo_caso === "buen_encaje");
    expect(buenEncaje).toHaveLength(3);
    for (const j of buenEncaje) expect(j.accion).toBe("postular");

    const encajeParcial = careerJobs.filter((j) => j.tipo_caso === "encaje_parcial");
    expect(encajeParcial).toHaveLength(2);
    for (const j of encajeParcial) expect(j.accion).toBe("guardar");

    const descarte = careerJobs.filter((j) => j.tipo_caso === "descarte");
    expect(descarte).toHaveLength(3);
    for (const j of descarte) expect(j.accion).toBe("descartar");
  });
});

describe("golden-carreras-beta · clasificación por título (sin LLM)", () => {
  const encajeJobs = jobs.filter((j) => j.tipo_caso !== "descarte");
  const descarteJobs = jobs.filter((j) => j.tipo_caso === "descarte");

  it.each(encajeJobs.map((j) => [j.id, j.carrera_esperada, j.titulo] as const))(
    "id %i (%s): el título '%s' es reconocido por la carrera",
    (_id, carrera, titulo) => {
      const normalized = normalizeTitleText(titulo);
      expect(
        matchesRoleTitle(normalized, carrera),
        `'${titulo}' debería ser reconocido por ${carrera}`,
      ).toBe(true);

      const hints = inferRoleHints({ sourceKind: "other", title: titulo });
      expect(hints, `'${titulo}' debería incluir el rol ${carrera} en sus hints`).toContain(
        carrera,
      );
    },
  );

  it.each(descarteJobs.map((j) => [j.id, j.carrera_esperada, j.titulo] as const))(
    "id %i (%s): el falso positivo '%s' NO es reconocido por la carrera ni suma su hint",
    (_id, carrera, titulo) => {
      const normalized = normalizeTitleText(titulo);
      expect(
        matchesRoleTitle(normalized, carrera),
        `'${titulo}' NO debería ser reconocido por ${carrera}`,
      ).toBe(false);

      const hints = inferRoleHints({ sourceKind: "other", title: titulo });
      expect(hints, `'${titulo}' NO debería incluir ${carrera} en sus hints`).not.toContain(
        carrera,
      );
    },
  );
});

describe("golden-carreras-beta · prefiltro esperado (sin LLM)", () => {
  const encajeJobs = jobs.filter((j) => j.tipo_caso !== "descarte");

  it.each(
    encajeJobs.map(
      (j) => [j.id, j.carrera_esperada, j.titulo, j.modalidad, j.ubicacion_raw] as const,
    ),
  )(
    "id %i: caso de encaje '%s' pasa el prefiltro para la carrera",
    (_id, carrera, title, modality, locationRaw) => {
      const result = prefilter({ title, modality: modality as never, locationRaw }, rules, {
        targetRoles: [carrera],
        acceptedModalities: ["remoto", "hibrido", "presencial"],
      });
      expect(result.pass, `el aviso '${title}' debería pasar el prefiltro para ${carrera}`).toBe(
        true,
      );
    },
  );

  it.each([
    [6, "finanzas_contabilidad", "Vendedor - sueldo fijo + comisión por ventas"],
    [
      16,
      "marketing_digital",
      "Emprendedor Independiente - Marketing Multinivel y Network Marketing",
    ],
    [38, "comunicacion", "Operario de Prensa Hidráulica y Estampado"],
  ] as const)(
    "id %i: falso positivo con motivo prefiltro '%s' descarta en prefilter para %s",
    (id, carrera, expectedTitle) => {
      const job = jobs.find((j) => j.id === id)!;
      expect(job.titulo).toBe(expectedTitle);
      const result = prefilter(
        { title: job.titulo, modality: job.modalidad as never, locationRaw: job.ubicacion_raw },
        rules,
        { targetRoles: [carrera] },
      );
      expect(result.pass).toBe(false);
    },
  );
});
