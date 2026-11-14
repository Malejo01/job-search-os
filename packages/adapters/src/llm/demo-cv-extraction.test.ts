import { cvExtractionSchema, normalizeCvExtraction } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { createDemoLlm, DEMO_MODEL } from "./demo";

const vars = {
  target_roles: "no especificado",
  candidate_skills: "sql | SQL\npython | Python\nfigma | Figma",
  today: "2026-11",
  role_keys: "data_analyst",
  cv: "<<<CV>>>\nTexto inventado de un CV de prueba.\n<<<FIN CV>>>",
};

describe("modo demo: extract_cv_profile", () => {
  it("devuelve una lectura inventada, válida para el esquema estricto y para la normalización", async () => {
    const r = await createDemoLlm().generateStructured(
      "extract_cv_profile",
      cvExtractionSchema,
      vars,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.model).toBe(DEMO_MODEL);
    const n = normalizeCvExtraction(r.value.object, {
      text: "Texto inventado de un CV de prueba.",
      candidates: [
        { slug: "sql", name: "SQL" },
        { slug: "python", name: "Python" },
      ],
      today: "2026-11-13",
    });
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.value.workHistory).toHaveLength(1);
    expect(n.value.education).toHaveLength(1);
    expect(n.value.languages).toEqual([{ name: "Inglés", level: null }]);
    expect(n.value.skills.map((s) => s.slug)).toEqual(["sql", "python"]);
  });
});
