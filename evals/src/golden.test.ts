import { describe, expect, it } from "vitest";
import { goldenJobs, goldenToJob, goldenVars } from "./golden";

describe("golden → prompt", () => {
  it("carga las 34 ofertas ordenadas por id", () => {
    expect(goldenJobs).toHaveLength(34);
    expect(goldenJobs.map((j) => j.id)).toEqual([...Array(34)].map((_, i) => i + 1));
  });

  it("no filtra la referencia humana al prompt (match, gaps, bloqueadores, señales, notas)", () => {
    for (const j of goldenJobs) {
      const text = goldenVars(j).job as string;
      // Tecnologías que también están en el stack del aviso no son fuga (ej. "AWS Beanstalk")
      const stack = j.stack.join(" | ");
      const leaks = [...j.match, ...j.gaps, ...j.bloqueadores, ...j.senales, j.score_nota ?? ""]
        .filter((s) => s.length >= 12)
        .filter((s) => !stack.includes(s))
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

  it("marca had_full_jd=false y arma la JD con nivel, años, inglés y stack", () => {
    const j = goldenJobs.find((x) => x.id === 19)!;
    const job = goldenToJob(j);
    expect(job.jdText).toContain("Años de experiencia requeridos: 5");
    expect(job.jdText).toContain("Stack y requisitos");
    expect(goldenVars(j).had_full_jd).toBe(false);
  });
});
