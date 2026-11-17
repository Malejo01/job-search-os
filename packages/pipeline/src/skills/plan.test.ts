import { describe, expect, it } from "vitest";
import roleSkillsSeed from "../../../db/seeds/role_skills.json";
import {
  OFF_FAMILY_MIN_MENTIONS,
  buildPlan,
  easeFromClosureHours,
  filterPlanByCareer,
  pickLearningResource,
  planPriority,
} from "./plan";
import { roleSkillsSchema } from "./self-assessment";

const roleSkills = roleSkillsSchema.parse(roleSkillsSeed);
const demand = (slug: string, mentions: number) => ({
  slug,
  mentions,
  mustMentions: mentions,
  weightedDemand: mentions * 5,
});

describe("el plan no propone skills de otra familia (R11-9)", () => {
  const accountingDemand = [
    demand("general_accounting", 30),
    demand("payroll", 12),
    demand("excel", 20),
    demand("growth_marketing", 2),
    demand("iam", 3),
    // Sin dueño en role_skills: lo delata la categoría (IA = tecnología)
    { ...demand("multimodal", 1), category: "ai_core" },
    demand("n8n", 2),
    demand("ip_law", 4),
    demand("some_unlisted_skill", 1),
  ];

  it("Contaduría: sale Growth, IAM, multimodal, n8n e IP con poca demanda", () => {
    const slugs = filterPlanByCareer(accountingDemand, "finanzas_contabilidad", roleSkills).map(
      (r) => r.slug,
    );
    expect(slugs).toEqual(["general_accounting", "payroll", "excel", "some_unlisted_skill"]);
  });

  it("transversales (Excel) y propias se quedan aunque se pidan poco", () => {
    const slugs = filterPlanByCareer(
      [demand("excel", 1), demand("payroll", 1)],
      "finanzas_contabilidad",
      roleSkills,
    ).map((r) => r.slug);
    expect(slugs).toEqual(["excel", "payroll"]);
  });

  it("una skill de otra familia entra si la demanda de la carrera la justifica", () => {
    const rows = [demand("general_accounting", 20), demand("iam", OFF_FAMILY_MIN_MENTIONS)];
    // 5 menciones = piso y 25% de 20: justifica
    expect(
      filterPlanByCareer(rows, "finanzas_contabilidad", roleSkills).map((r) => r.slug),
    ).toContain("iam");
    // 4 menciones: no
    const few = [demand("general_accounting", 20), demand("iam", OFF_FAMILY_MIN_MENTIONS - 1)];
    expect(
      filterPlanByCareer(few, "finanzas_contabilidad", roleSkills).map((r) => r.slug),
    ).not.toContain("iam");
  });

  it("el piso es relativo: con una skill propia muy pedida, 5 menciones no alcanzan", () => {
    const rows = [demand("general_accounting", 100), demand("iam", 6)];
    expect(
      filterPlanByCareer(rows, "finanzas_contabilidad", roleSkills).map((r) => r.slug),
    ).toEqual(["general_accounting"]);
  });

  it("en tecnología las carreras del grupo comparten familia", () => {
    const rows = [demand("rag", 1), demand("docker", 1)];
    expect(filterPlanByCareer(rows, "backend", roleSkills).map((r) => r.slug)).toEqual([
      "rag",
      "docker",
    ]);
  });

  it("Contaduría no hereda Propiedad intelectual de Abogacía; Abogacía sí la tiene", () => {
    const rows = [demand("ip_law", 1), demand("contract_drafting", 1)];
    expect(filterPlanByCareer(rows, "finanzas_contabilidad", roleSkills)).toEqual([]);
    expect(filterPlanByCareer(rows, "abogacia", roleSkills).map((r) => r.slug)).toEqual([
      "ip_law",
      "contract_drafting",
    ]);
  });

  it("la salida de buildPlan después del filtro no trae las skills cortadas", () => {
    const filtered = filterPlanByCareer(accountingDemand, "finanzas_contabilidad", roleSkills);
    const plan = buildPlan(filtered.map((r) => ({ ...r, level: null, closureHours: 16 })));
    expect(plan.map((p) => p.slug)).not.toContain("growth_marketing");
  });
});

describe("pickLearningResource (121 §7)", () => {
  const r = (id: string, targetLevel: number, hours: number | null) => ({ id, targetLevel, hours });

  it("sin recursos que suban el nivel, ninguno", () => {
    expect(pickLearningResource([], 0)).toBeNull();
    expect(pickLearningResource([r("a", 1, 4), r("b", 2, 10)], 2)).toBeNull();
  });

  it("el de menos horas que sube el nivel", () => {
    expect(pickLearningResource([r("b", 2, 10), r("a", 2, 6)], 0)?.id).toBe("a");
    // nivel 1: el de nivel 1 no sube nada
    expect(pickLearningResource([r("a", 1, 2), r("b", 2, 10)], 1)?.id).toBe("b");
  });

  it("prefiere el que lleva a nivel 2 si cuesta como mucho el doble", () => {
    expect(pickLearningResource([r("n1", 1, 5), r("n2", 2, 10)], 0)?.id).toBe("n2");
    expect(pickLearningResource([r("n1", 1, 5), r("n2", 2, 11)], 0)?.id).toBe("n1");
    expect(pickLearningResource([r("n1", 1, 5), r("n2", 3, 8)], null)?.id).toBe("n2");
    // De los de nivel 2 dentro del límite, el de menos horas
    const three = [r("caro", 2, 20), r("n1", 1, 5), r("medio", 2, 9)];
    expect(pickLearningResource(three, 0)?.id).toBe("medio");
  });

  it("sin horas conocidas no compara: queda el de menos horas, y los sin dato al final", () => {
    expect(pickLearningResource([r("x", 2, null), r("n1", 1, 5)], 0)?.id).toBe("n1");
    expect(pickLearningResource([r("x", 2, null)], 0)?.id).toBe("x");
  });

  it("a igualdad de horas respeta el orden de entrada", () => {
    expect(pickLearningResource([r("a", 2, 6), r("b", 2, 6)], 0)?.id).toBe("a");
  });
});

describe("plan de formación: prioridad = demanda × (1 − nivel/3) × facilidad", () => {
  it("facilidad desde closure_hours: 16 h → 1, 40 h → 0,4, 80 h → 0,2, sin dato → 0,5", () => {
    expect(easeFromClosureHours(16)).toBe(1);
    expect(easeFromClosureHours(8)).toBe(1);
    expect(easeFromClosureHours(40)).toBeCloseTo(0.4, 6);
    expect(easeFromClosureHours(80)).toBeCloseTo(0.2, 6);
    expect(easeFromClosureHours(null)).toBe(0.5);
    expect(easeFromClosureHours(1000)).toBe(0.1);
  });

  it("una skill barata de cerrar le gana a una cara con la misma demanda; nivel 3 queda fuera", () => {
    expect(planPriority(40, 1, 16)).toBeCloseTo(40 * (2 / 3) * 1, 2);
    expect(planPriority(40, 0, 80)).toBeCloseTo(40 * 1 * 0.2, 2);
    expect(planPriority(40, 3, 16)).toBe(0);
    expect(planPriority(40, null, 16)).toBe(40); // sin nivel = 0
  });

  it("ordena por prioridad y estima horas restantes", () => {
    const plan = buildPlan([
      {
        slug: "ci_cd",
        mentions: 9,
        mustMentions: 9,
        weightedDemand: 41.5,
        level: 1,
        closureHours: 16,
      },
      { slug: "aws", mentions: 9, mustMentions: 9, weightedDemand: 38, level: 0, closureHours: 40 },
      {
        slug: "fine_tuning",
        mentions: 2,
        mustMentions: 2,
        weightedDemand: 3,
        level: 0,
        closureHours: 80,
      },
      {
        slug: "rag",
        mentions: 10,
        mustMentions: 9,
        weightedDemand: 46.2,
        level: 3,
        closureHours: 0,
      },
      {
        slug: "nosql",
        mentions: 3,
        mustMentions: 3,
        weightedDemand: 11.5,
        level: null,
        closureHours: null,
      },
    ]);
    expect(plan.map((p) => p.slug)).toEqual(["ci_cd", "aws", "nosql", "fine_tuning"]);
    expect(plan[0]).toMatchObject({ priority: 27.67, hoursRemaining: 11 });
    expect(plan[1]).toMatchObject({ priority: 15.2, hoursRemaining: 40 });
    expect(plan[2]).toMatchObject({ priority: 5.75, hoursRemaining: null });
  });
});
