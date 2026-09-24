import { describe, expect, it } from "vitest";
import { goldenJobs, goldenToJob, goldenVars } from "./golden";

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
    const pencil = goldenJobs.find((x) => x.id === 35)!;
    const job = goldenToJob(pencil);
    // Los requisitos tienen que llegar al modelo: son los que definen la disciplina
    expect(job.jdText).toContain("2-3 years' experience in advertising creative development");
    expect(job.jdText).toContain("Proficiency in Adobe Creative Cloud");
    expect(job.jdText).not.toContain("Stack y requisitos");
    expect(goldenVars(pencil).had_full_jd).toBe(true);

    const steuart = goldenJobs.find((x) => x.id === 36)!;
    expect(goldenToJob(steuart).jdText).toContain("Excellent written English");
    expect(goldenVars(steuart).had_full_jd).toBe(true);
  });
});
