import { describe, expect, it } from "vitest";
import { goldenJobs, goldenToJob, goldenVars, hashCriteria } from "./golden";

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
  it("carga las 36 ofertas ordenadas por id", () => {
    expect(goldenJobs).toHaveLength(36);
    expect(goldenJobs.map((j) => j.id)).toEqual([...Array(36)].map((_, i) => i + 1));
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
