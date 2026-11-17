import { cvSkillGaps } from "@job-search-os/pipeline";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fixtureProblems,
  fixtureShapeProblems,
  loadCvCoachGolden,
  PRIVATE_EXAMPLE_DIR,
  PUBLIC_DIR,
  reviewContext,
} from "./golden";

const ROOT = join(PUBLIC_DIR, "../../..");
const golden = loadCvCoachGolden();
const BETA_CAREERS = [
  "abogacia",
  "finanzas_contabilidad",
  "administracion_empresas",
  "comunicacion",
  "marketing_digital",
  "relaciones_publicas",
  "relaciones_internacionales",
  "fullstack",
];

describe("golden del coach (plan §5.1)", () => {
  it("11 fixtures públicas: las 3 de #514 y una por carrera de la beta", () => {
    expect(golden).toHaveLength(11);
    expect(golden.every((g) => g.source === "public")).toBe(true);
    for (const name of ["sin-experiencia", "con-experiencia", "cambio-de-carrera"]) {
      const g = golden.find((x) => x.fixture.id === name)!;
      const original = readFileSync(
        join(ROOT, `packages/pipeline/test/fixtures/cv-perfil/${name}.txt`),
        "utf8",
      );
      expect(g.fixture.cv_texto).toBe(original);
    }
    const others = golden.filter(
      (g) => !["sin-experiencia", "con-experiencia", "cambio-de-carrera"].includes(g.fixture.id),
    );
    expect(others.map((g) => g.fixture.carrera).sort()).toEqual([...BETA_CAREERS].sort());
  });

  it("el caso del 17/11 está, con nombres ficticios: dos años, cuatro proyectos y la docencia arriba", () => {
    const f = golden.find((g) => g.fixture.id === "fullstack-17-11")!.fixture;
    const projects = f.lectura.items.filter((i) => i.kind === "proyecto");
    expect(projects.map((p) => p.organization)).toEqual([
      "Proyecto 1",
      "Proyecto 2",
      "Proyecto 3",
      "Proyecto 4",
    ]);
    expect(f.lectura.items[0]!.title).toMatch(/docente/i);
    expect(f.lectura.items.some((i) => i.organization === "Empresa A")).toBe(true);
  });

  it("cada fixture es coherente: claves, slugs de la taxonomía, respuestas con destino", () => {
    for (const g of golden) expect(fixtureProblems(g.fixture), g.fixture.id).toEqual([]);
  });

  it("los problemas esperados de datos son los que calcula el código con la demanda (están alineados)", () => {
    for (const { fixture: f } of golden) {
      const gaps = cvSkillGaps(reviewContext(f))
        .map((g) => `${g.type}:${g.skillSlug}`)
        .sort();
      const expected = f.problemas_esperados
        .filter((e) => "skill" in e)
        .map((e) => `${e.tipo}:${(e as { skill: string }).skill}`)
        .sort();
      expect(expected, f.id).toEqual(gaps);
    }
  });

  it("cada hecho del CV está en el texto del CV (si no, «perdido» no significaría nada)", () => {
    for (const { fixture: f } of golden) {
      const text = f.cv_texto.toLowerCase();
      for (const h of f.hechos.filter(
        (x) =>
          x.fuente === "cv" && x.clave !== "fecha" && x.clave !== "cargo" && x.clave !== "titulo",
      )) {
        expect(text.includes(h.valor.toLowerCase()), `${f.id}: ${h.clave}`).toBe(true);
      }
    }
  });

  it("los hechos de respuesta salen de alguna respuesta guionada", () => {
    for (const { fixture: f } of golden) {
      const said = JSON.stringify(f.respuestas).toLowerCase();
      for (const h of f.hechos.filter((x) => x.fuente === "respuesta")) {
        expect(said.includes(h.valor.toLowerCase()), `${f.id}: ${h.valor}`).toBe(true);
      }
    }
  });

  it("ninguna fixture pública trae datos de contacto reales: emails y links solo de ejemplo.com, sin teléfonos ni DNI", () => {
    for (const g of golden) {
      const raw = readFileSync(g.path, "utf8");
      for (const email of raw.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])
        expect(email, g.fixture.id).toMatch(/@ejemplo\.com$/);
      for (const url of raw.match(/https?:\/\/[^\s"]+/g) ?? [])
        expect(url, g.fixture.id).toMatch(/^https:\/\/ejemplo\.com\//);
      // Teléfonos y DNI, en lo que es texto de la persona (los ids de ítem son uuids con guiones)
      const said = `${g.fixture.cv_texto}\n${JSON.stringify(g.fixture.respuestas)}`;
      expect(said, g.fixture.id).not.toMatch(/\+?\d{2,4}[ -]?\d{3,4}[ -]\d{4}/);
      expect(said, g.fixture.id).not.toMatch(/\b\d{2}\.\d{3}\.\d{3}\b/);
      // Las personas son «PERSONA EJEMPLO X»: ningún nombre y apellido en el encabezado
      expect(g.fixture.cv_texto.split("\n")[0], g.fixture.id).toMatch(/^PERSONA EJEMPLO [A-Z]$/);
    }
  });

  it("una fixture con una clave de más, o sin hechos, no carga (falla cerrado y sin citar el contenido)", () => {
    const f = JSON.parse(JSON.stringify(golden[0]!.fixture)) as Record<string, unknown>;
    expect(fixtureShapeProblems({ ...f, extra: 1 })).toContain("fixture: clave de más «extra»");
    expect(fixtureShapeProblems({ ...f, hechos: [] })).toContain("hechos");
    const problems = fixtureShapeProblems({ ...f, cv_texto: "corto" });
    expect(problems.join(" ")).not.toContain("corto");
  });
});

describe("fixtures privadas", () => {
  it("se cargan solo con `privadas` y quedan marcadas como privadas", () => {
    const withExample = loadCvCoachGolden({ privadas: true, privateDir: PRIVATE_EXAMPLE_DIR });
    const priv = withExample.filter((g) => g.source === "private");
    expect(priv.map((g) => g.fixture.id)).toEqual(["mauro-ejemplo"]);
    expect(
      loadCvCoachGolden({ privateDir: PRIVATE_EXAMPLE_DIR }).some((g) => g.source === "private"),
    ).toBe(false);
  });

  it("sin la carpeta privada (CI, un clon del repo) no pasa nada", () => {
    expect(loadCvCoachGolden({ privadas: true, privateDir: join(ROOT, "no-existe") })).toHaveLength(
      11,
    );
  });
});
