import { describe, expect, it } from "vitest";
import {
  adversarialJobs,
  baseGoldenJobs,
  goldenJobs,
  goldenToJob,
  goldenVars,
  hashCriteria,
  targetRoleLabel,
} from "./golden";

describe("hashCriteria (JS-067)", () => {
  it("no depende del orden de las claves y cambia con cualquier valor", () => {
    expect(hashCriteria({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(
      hashCriteria({ b: { d: "x", c: [1, 2] }, a: 1 }),
    );
    expect(hashCriteria({ a: 1 })).not.toBe(hashCriteria({ a: 2 }));
    expect(hashCriteria({ a: 1 })).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("golden → prompt", () => {
  it("carga las 36 ofertas del golden ordenadas por id, más los 4 adversariales (101–104)", () => {
    expect(baseGoldenJobs).toHaveLength(36);
    expect(baseGoldenJobs.map((j) => j.id)).toEqual([...Array(36)].map((_, i) => i + 1));
    expect(adversarialJobs.map((j) => j.id)).toEqual([101, 102, 103, 104]);
    expect(goldenJobs.map((j) => j.id)).toEqual(
      [...baseGoldenJobs, ...adversarialJobs].map((j) => j.id),
    );
    expect(baseGoldenJobs.some((j) => j.adversarial)).toBe(false);
  });

  it("los adversariales son inventados, tienen jd y llevan el riesgo humano de instrucciones", () => {
    for (const j of adversarialJobs) {
      expect(j.adversarial, `job ${j.id}`).toBe(true);
      expect(j.empresa).toMatch(/^Empresa Ficticia \d$/);
      expect(j.jd?.trim().length, `job ${j.id} sin jd`).toBeGreaterThan(200);
      expect(j.human_risks).toContain("aviso con instrucciones al evaluador");
      expect(j.human_score_match).toBeGreaterThanOrEqual(3);
      expect(j.human_score_match).toBeLessThanOrEqual(5);
      expect(j.anchor_source).toBe("human");
      expect(goldenVars(j).had_full_jd).toBe(true);
    }
  });

  it("ningún campo de referencia de los adversariales entra al prompt", () => {
    for (const j of adversarialJobs) {
      const text = goldenVars(j, "evaluate_job@v1.4.0").job as string;
      const aviso = [j.stack.join(" | "), j.jd ?? ""].join(" | ");
      const leaks = [...j.match, ...j.gaps, ...j.bloqueadores, ...j.senales, j.score_nota ?? ""]
        .filter((s) => s.length >= 12)
        .filter((s) => !aviso.includes(s))
        .filter((s) => text.includes(s));
      expect(leaks, `job ${j.id} filtra: ${leaks.join(" | ")}`).toEqual([]);
      expect(text).not.toMatch(/human_score|score humano|human_risks/i);
      expect(text).not.toContain(j.score_nota ?? "\0");
    }
  });

  it("v1.4.0 recibe el aviso delimitado; v1.3.4 el texto de siempre", () => {
    const j = adversarialJobs[0]!;
    const nuevo = goldenVars(j, "evaluate_job@v1.4.0").job as string;
    const vigente = goldenVars(j, "evaluate_job@v1.3.4").job as string;
    expect(nuevo).toContain("<<<AVISO>>>");
    expect(nuevo).toContain("<<<FIN AVISO>>>");
    expect(vigente).not.toContain("<<<AVISO>>>");
    expect(goldenVars(j).job).toBe(vigente);
    // El perfil de referencia no trae puesto objetivo (el privado podría traerlo)
    expect(goldenVars(j, "evaluate_job@v1.4.0").target_role).toBe(
      targetRoleLabel ?? "no especificado",
    );
  });

  it("no filtra la referencia humana al prompt (match, gaps, bloqueadores, señales, notas)", () => {
    for (const j of goldenJobs) {
      const text = goldenVars(j).job as string;
      // Lo que está en el aviso (stack o JD recortada) no es fuga (ej. "AWS Beanstalk")
      const aviso = [j.stack.join(" | "), j.jd ?? ""].join(" | ");
      const leaks = [...j.match, ...j.gaps, ...j.bloqueadores, ...j.senales, j.score_nota ?? ""]
        .filter((s) => s.length >= 12)
        .filter((s) => !aviso.includes(s))
        .filter((s) => text.includes(s));
      expect(leaks, `job ${j.id} filtra: ${leaks.join(" | ")}`).toEqual([]);
      expect(text).not.toMatch(/human_score|score humano/i);
    }
  });

  it("sobre ubicación solo entra ubicacion_raw; paises (interpretación humana) no", () => {
    for (const j of goldenJobs) {
      const text = goldenVars(j).job as string;
      expect(text).toContain(`- Ubicación: ${j.ubicacion_raw}`);
      expect(text).not.toContain("Países permitidos");
    }
    const latam = goldenJobs.find((x) => x.id === 34)!;
    expect(goldenVars(latam).job).toContain("LATAM (100% remote)");
  });

  it("sin jd: had_full_jd=false y la JD se arma con nivel, años, inglés y stack", () => {
    const j = goldenJobs.find((x) => x.id === 19)!;
    const job = goldenToJob(j);
    expect(job.jdText).toContain("Años de experiencia requeridos: 5");
    expect(job.jdText).toContain("Stack y requisitos");
    expect(goldenVars(j).had_full_jd).toBe(false);
  });

  it("con jd (ids 35 y 36): entra el texto del aviso y had_full_jd=true", () => {
    const golden35 = goldenJobs.find((x) => x.id === 35)!;
    const job = goldenToJob(golden35);
    // Los requisitos tienen que llegar al modelo: son los que definen la disciplina. Se buscan
    // marcas presentes en las dos versiones (la completa del golden privado y la parafraseada
    // del público), no oraciones textuales del aviso.
    expect(job.jdText).toMatch(/2-3 years/);
    expect(job.jdText).toMatch(/advertising/i);
    expect(job.jdText).toContain("Proficiency in Adobe Creative Cloud");
    expect(job.jdText).not.toContain("Stack y requisitos");
    expect(goldenVars(golden35).had_full_jd).toBe(true);

    const golden36 = goldenJobs.find((x) => x.id === 36)!;
    expect(goldenToJob(golden36).jdText).toContain("Excellent written English");
    expect(goldenToJob(golden36).jdText).toMatch(/US Eastern/);
    expect(goldenVars(golden36).had_full_jd).toBe(true);
  });
});
