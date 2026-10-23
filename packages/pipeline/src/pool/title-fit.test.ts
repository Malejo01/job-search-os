import { describe, expect, it } from "vitest";
import {
  assessPoolTitle,
  isTooSenior,
  strongTitlePattern,
  titleFit,
  titleLevel,
} from "./title-fit";

describe("titleFit · carreras de producto (ronda 97)", () => {
  it("separa las cuatro cuando la categoría las junta", () => {
    expect(titleFit("Senior Scrum Master", "product_manager")).toBe(0);
    expect(titleFit("Senior Scrum Master", "project_manager")).toBe(2);
    expect(titleFit("Product Owner", "product_marketing")).toBe(0);
    expect(titleFit("Product Owner", "product_owner")).toBe(2);
    expect(titleFit("Product Marketing Manager", "product_manager")).toBe(0);
    expect(titleFit("Product Marketing Manager", "product_marketing")).toBe(2);
  });

  it("sin frase de ninguna carrera nada se veta", () => {
    expect(titleFit("Product Specialist", "product_manager")).toBe(1);
    expect(titleFit("Product Specialist", "product_owner")).toBe(1);
  });

  it("vetan desarrollo y diseño, pero la frase propia gana", () => {
    expect(titleFit("Product Engineer", "product_manager")).toBe(0);
    expect(titleFit("Product Designer", "product_owner")).toBe(0);
    expect(titleFit("Technical Product Manager, Developer Tools", "product_manager")).toBe(2);
  });

  it("assessPoolTitle saca del hint efectivo al puesto vetado", () => {
    const r = assessPoolTitle({
      title: "Senior Scrum Master",
      roleHints: ["product_manager", "product_owner", "project_manager"],
      roles: ["product_manager"],
      yearsTotal: null,
    });
    expect(r.titleFit).toBe(0);
    expect(r.effectiveHints).toEqual(["product_owner", "project_manager"]);
  });
});

describe("titleFit · data_engineer y solutions_engineer (ronda 106)", () => {
  it("data engineer y data analyst se vetan entre sí cuando la categoría las junta", () => {
    expect(titleFit("Senior Data Engineer", "data_engineer")).toBe(2);
    expect(titleFit("Senior Data Engineer", "data_analyst")).toBe(0);
    expect(titleFit("Data Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Data Analyst", "data_engineer")).toBe(0);
    expect(titleFit("Data Scientist", "data_engineer")).toBe(0);
  });

  it("un título de datos sin frase de ninguna no se veta", () => {
    expect(titleFit("Data Specialist", "data_engineer")).toBe(1);
  });

  it("solutions_engineer: el cargo nombrado vale 2 y el field engineer suelto no", () => {
    expect(titleFit("Solutions Architect", "solutions_engineer")).toBe(2);
    expect(titleFit("Sales Engineer", "solutions_engineer")).toBe(2);
    expect(titleFit("Customer Field Engineer", "solutions_engineer")).toBe(2);
    expect(titleFit("Field Engineer", "solutions_engineer")).toBe(1);
  });

  it("las exclusiones de role-hints también valen acá", () => {
    expect(titleFit("Physical Security Engineer", "ciberseguridad")).toBe(1);
    expect(titleFit("Security Architect", "ciberseguridad")).toBe(2);
    expect(titleFit("Manufacturing Product Engineer", "fullstack")).toBe(1);
    expect(titleFit("Product Engineer, Manufacturing", "fullstack")).toBe(1);
    expect(titleFit("Product Engineer", "fullstack")).toBe(2);
    expect(titleFit("Full Stack Engineer, Hardware Platform", "fullstack")).toBe(2);
  });
});

describe("titleFit · ventas y atención (ronda 107)", () => {
  it("ventas_b2b: el cargo vale 2; los técnicos y las vecinas se vetan", () => {
    expect(titleFit("Account Executive", "ventas_b2b")).toBe(2);
    expect(titleFit("Key Account Manager", "ventas_b2b")).toBe(2);
    expect(titleFit("Sales Engineer", "ventas_b2b")).toBe(0);
    expect(titleFit("Customer Success Manager", "ventas_b2b")).toBe(0);
    expect(titleFit("Customer Support Specialist", "ventas_b2b")).toBe(0);
    expect(titleFit("Business Developer", "ventas_b2b")).toBe(0);
    expect(titleFit("Regional Specialist", "ventas_b2b")).toBe(1);
  });

  it("solutions_engineer veta los títulos de ventas", () => {
    expect(titleFit("Account Executive", "solutions_engineer")).toBe(0);
    expect(titleFit("Sales Manager", "solutions_engineer")).toBe(0);
    expect(titleFit("Sales Engineer", "solutions_engineer")).toBe(2);
  });

  it("atencion_cliente: el cargo vale 2; technical, success e IT no son atención", () => {
    expect(titleFit("Customer Support Specialist", "atencion_cliente")).toBe(2);
    expect(titleFit("Call Center Agent", "atencion_cliente")).toBe(2);
    expect(titleFit("Customer Success Manager", "atencion_cliente")).toBe(0);
    expect(titleFit("Technical Support Specialist", "atencion_cliente")).toBe(0);
    expect(titleFit("IT Support Specialist", "atencion_cliente")).toBe(0);
    expect(titleFit("Customer Support Engineer", "atencion_cliente")).toBe(0);
    expect(titleFit("Help Desk Analyst", "atencion_cliente")).toBe(0);
    expect(titleFit("Operations Associate", "atencion_cliente")).toBe(1);
  });

  it("soporte_it veta call center y atención, pero no 'customer support'", () => {
    expect(titleFit("Call Center Agent", "soporte_it")).toBe(0);
    expect(titleFit("Atención al Cliente", "soporte_it")).toBe(0);
    expect(titleFit("Customer Support Specialist", "soporte_it")).toBe(1);
    expect(titleFit("Customer Support Engineer", "soporte_it")).toBe(1);
    expect(titleFit("Technical Support Specialist", "soporte_it")).toBe(2);
  });

  it("customer_success veta ventas y atención", () => {
    expect(titleFit("Customer Success Manager", "customer_success")).toBe(2);
    expect(titleFit("Technical Account Manager", "customer_success")).toBe(2);
    expect(titleFit("Customer Support Specialist", "customer_success")).toBe(0);
    expect(titleFit("Account Executive", "customer_success")).toBe(0);
    expect(titleFit("Account Manager", "customer_success")).toBe(1);
  });

  it("assessPoolTitle: con la categoría customer-support el título deja la carrera que corresponde", () => {
    const base = { roleHints: ["customer_success", "atencion_cliente"], yearsTotal: null };
    const support = assessPoolTitle({
      ...base,
      title: "Customer Support Specialist",
      roles: ["customer_success"],
    });
    expect(support.titleFit).toBe(0);
    expect(support.effectiveHints).toEqual(["atencion_cliente"]);
    const csm = assessPoolTitle({
      ...base,
      title: "Customer Success Manager",
      roles: ["atencion_cliente"],
    });
    expect(csm.titleFit).toBe(0);
    expect(csm.effectiveHints).toEqual(["customer_success"]);
  });
});

describe("titleFit · finanzas y asistencia/operaciones (C-2b)", () => {
  it("finanzas_contabilidad: el cargo vale 2; datos y desarrollo se vetan", () => {
    expect(titleFit("Senior Accountant", "finanzas_contabilidad")).toBe(2);
    expect(titleFit("Sales Tax Analyst", "finanzas_contabilidad")).toBe(2);
    expect(titleFit("Contador Público", "finanzas_contabilidad")).toBe(2);
    expect(titleFit("Finance Specialist", "finanzas_contabilidad")).toBe(2);
    expect(titleFit("Finance Manager", "finanzas_contabilidad")).toBe(1);
    expect(titleFit("Financial Data Engineer", "finanzas_contabilidad")).toBe(0);
    expect(titleFit("Accounting Software Engineer", "finanzas_contabilidad")).toBe(0);
    expect(titleFit("Financial Engineer", "finanzas_contabilidad")).toBe(0);
    expect(titleFit("Finance Developer", "finanzas_contabilidad")).toBe(0);
  });

  it("asistencia_operaciones: el cargo vale 2; proyectos, soporte IT y finanzas se vetan", () => {
    expect(titleFit("Virtual Assistant", "asistencia_operaciones")).toBe(2);
    expect(titleFit("Operations Coordinator", "asistencia_operaciones")).toBe(2);
    expect(titleFit("Asistente Administrativa", "asistencia_operaciones")).toBe(2);
    expect(titleFit("Operations Lead", "asistencia_operaciones")).toBe(1);
    expect(titleFit("Project Manager", "asistencia_operaciones")).toBe(0);
    expect(titleFit("IT Support Specialist", "asistencia_operaciones")).toBe(0);
    expect(titleFit("Senior Accountant", "asistencia_operaciones")).toBe(0);
    expect(titleFit("Operations Engineer", "asistencia_operaciones")).toBe(0);
    // la exclusión de role-hints (otra operación) lo deja sin nombrar el cargo, pero sin veto
    expect(titleFit("Sales Operations Coordinator", "asistencia_operaciones")).toBe(1);
  });

  it("project_manager veta los títulos de operaciones (D9), pero la frase propia gana", () => {
    expect(titleFit("Virtual Assistant", "project_manager")).toBe(0);
    expect(titleFit("Operations Coordinator", "project_manager")).toBe(0);
    expect(titleFit("Project Manager", "project_manager")).toBe(2);
    expect(titleFit("Operations Coordinator & Project Manager", "project_manager")).toBe(2);
  });

  it("assessPoolTitle: con la categoría de operaciones el título deja la carrera que corresponde", () => {
    const r = assessPoolTitle({
      title: "Executive Assistant",
      roleHints: ["project_manager", "asistencia_operaciones"],
      roles: ["project_manager"],
      yearsTotal: null,
    });
    expect(r.titleFit).toBe(0);
    expect(r.effectiveHints).toEqual(["asistencia_operaciones"]);
  });
});

describe("titleFit", () => {
  it("2 cuando el título nombra el cargo", () => {
    expect(titleFit("Data Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Analista de Datos Semi Senior", "data_analyst")).toBe(2);
    expect(titleFit("BI Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Reporting Analyst, Finance", "data_analyst")).toBe(2);
    expect(titleFit("Insights Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Analytics Analyst II", "data_analyst")).toBe(2);
    expect(titleFit("Business Intelligence Developer", "data_analyst")).toBe(2);
    expect(titleFit("Fraud Data Analyst", "data_analyst")).toBe(2);
  });

  it("analytics engineer pasó a data_engineer (ronda 106): data_analyst lo veta", () => {
    expect(titleFit("Analytics Engineer", "data_analyst")).toBe(0);
    expect(titleFit("Analytics Engineer", "data_engineer")).toBe(2);
  });

  it("data scientist y product analyst nombran data_analyst", () => {
    expect(titleFit("Data Scientist", "data_analyst")).toBe(2);
    expect(titleFit("Product Analyst", "data_analyst")).toBe(2);
  });

  it("con frase fuerte no hay veto aunque el título mencione otra disciplina", () => {
    expect(titleFit("Data Analyst / Data Engineer", "data_analyst")).toBe(2);
    expect(titleFit("Data Analyst, Machine Learning", "data_analyst")).toBe(2);
  });

  it("0 cuando el título nombra otra disciplina y no tiene frase del puesto", () => {
    for (const t of [
      "Senior Data Engineer",
      "Machine Learning Researcher",
      "ML Engineer",
      "AI Engineer",
      "Research Scientist",
      "Applied Scientist",
      "MLOps Specialist",
      "Staff Software Engineer, Data Platform",
      "Backend Engineer (Data)",
      "Frontend Developer, Data Products",
      "Full Stack Engineer",
      "DevOps Engineer",
      "SRE, Data",
      "Platform Engineer",
    ]) {
      expect(titleFit(t, "data_analyst"), t).toBe(0);
    }
  });

  it("1 cuando el puesto vino de la categoría y el título no nombra otra disciplina", () => {
    expect(titleFit("Reporting Specialist", "data_analyst")).toBe(1);
    expect(titleFit("Junior Associate", "data_analyst")).toBe(1);
  });

  it("ai_engineer: 2 con frase o patrón AI + rol técnico; 0 con palabra excluida sin frase", () => {
    expect(titleFit("Machine Learning Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("AI Software Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("AI Sales Specialist", "ai_engineer")).toBe(0);
    expect(titleFit("AI Customer Support Lead", "ai_engineer")).toBe(0);
    expect(titleFit("Solutions Specialist", "ai_engineer")).toBe(1);
  });

  it("ai_engineer: el patrón AI + rol técnico también vale con el rol en español", () => {
    expect(titleFit("Desarrollador Full-Stack AI Native", "ai_engineer")).toBe(2);
    expect(titleFit("Ingeniera de ML", "ai_engineer")).toBe(2);
    expect(titleFit("Arquitecto AI", "ai_engineer")).toBe(2);
    expect(titleFit("Desarrollador Backend", "ai_engineer")).toBe(1);
    expect(titleFit("Desarrollador UX AI", "ai_engineer")).toBe(0);
  });

  it("ai_engineer: 'AI' suelto al final no nombra el puesto si el núcleo es otra disciplina", () => {
    expect(titleFit("Legacy Tool to Cloud Platform Migration Engineer AI", "ai_engineer")).not.toBe(
      2,
    );
    expect(titleFit("Data Engineer AI", "ai_engineer")).not.toBe(2);
    // No se fuerza a 0: cae a la lógica de veto/1 de siempre.
    expect(titleFit("Legacy Tool to Cloud Platform Migration Engineer AI", "ai_engineer")).toBe(1);
  });

  it("ai_engineer: scientist/researcher con 'data' delante siguen nombrando el puesto", () => {
    expect(titleFit("Data Scientist, ML", "ai_engineer")).toBe(2);
    expect(titleFit("Data Scientist - AI", "ai_engineer")).toBe(2);
    expect(titleFit("Data Engineer AI", "ai_engineer")).not.toBe(2);
  });

  it("ai_engineer: 'AI' antes del rol, o después con núcleo de software, nombra el puesto", () => {
    expect(titleFit("Software Engineer, AI", "ai_engineer")).toBe(2);
    expect(titleFit("Software Engineer - AI/ML", "ai_engineer")).toBe(2);
    expect(titleFit("AI Software Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("ML Infrastructure Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("AI Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("AI Data Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("Desarrollador Full-Stack AI Native", "ai_engineer")).toBe(2);
  });

  it("data_analyst: análisis de fraude es análisis con datos", () => {
    expect(titleFit("Fraud Operations Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Fraud Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Fraud Operations Analyst (Region A)", "data_analyst")).toBe(2);
  });

  it("puestos sin veto definido dan 2 con frase y 1 sin ella", () => {
    expect(titleFit("QA Automation Engineer", "qa")).toBe(2);
    expect(titleFit("Release Coordinator", "qa")).toBe(1);
  });
});

describe("strongTitlePattern", () => {
  it("arma una alternancia con las frases de los puestos; sin puestos, null", () => {
    expect(strongTitlePattern([])).toBeNull();
    const p = strongTitlePattern(["data_analyst"])!;
    expect(p).toContain("data[^[:alnum:]]+analyst");
    expect(p.startsWith("\\m(")).toBe(true);
    expect(p.endsWith(")s?\\M")).toBe(true);
  });

  it("incluye las frases de fraude de data_analyst", () => {
    const p = strongTitlePattern(["data_analyst"])!;
    expect(p).toContain("fraud[^[:alnum:]]+operations[^[:alnum:]]+analyst");
    expect(p).toContain("fraud[^[:alnum:]]+analyst");
  });
});

describe("titleLevel", () => {
  it("staff_plus por palabra, sin pedir rol técnico", () => {
    for (const t of [
      "Staff ML Engineer",
      "Principal Data Analyst",
      "Head of Data",
      "Director of Analytics",
      "VP Engineering",
      "Chief Data Officer",
      "Group Product Manager",
      "Group Engineering Lead",
      "Group Manager",
    ]) {
      expect(titleLevel(t), t).toBe("staff_plus");
    }
  });

  it("group suelto no cuenta", () => {
    expect(titleLevel("Data Analyst, Risk Group")).toBeNull();
    expect(titleLevel("Analyst, Group Reporting")).toBeNull();
  });

  it("senior solo si es Senior o Lead puros", () => {
    expect(titleLevel("Senior Data Engineer")).toBe("senior");
    expect(titleLevel("Sr. Data Analyst")).toBe("senior");
    expect(titleLevel("Tech Lead, Data")).toBe("senior");
    expect(titleLevel("Mid/Senior Data Analyst")).toBeNull();
    expect(titleLevel("Junior to Senior Analyst")).toBeNull();
    expect(titleLevel("Data Analyst")).toBeNull();
    expect(titleLevel("Lead Generation Analyst")).toBeNull();
  });

  it("staff_plus manda sobre senior", () => {
    expect(titleLevel("Senior Staff Engineer")).toBe("staff_plus");
  });
});

describe("isTooSenior", () => {
  it("staff_plus con menos de 5 años; nada con 5 o más o sin dato", () => {
    expect(isTooSenior("Staff Data Analyst", 3)).toBe(true);
    expect(isTooSenior("Staff Data Analyst", 5)).toBe(false);
    expect(isTooSenior("Staff Data Analyst", null)).toBe(false);
    expect(isTooSenior("Staff Data Analyst", undefined)).toBe(false);
    expect(isTooSenior("Senior Data Analyst", 3)).toBe(false);
  });
});

describe("assessPoolTitle", () => {
  const base = { roles: ["data_analyst"] as const, yearsTotal: 3 };

  it("titleFit es el máximo entre los puestos de la persona que están en los hints", () => {
    const r = assessPoolTitle({
      title: "Data Analyst",
      roleHints: ["data_analyst", "backend"],
      roles: ["backend", "data_analyst"],
      yearsTotal: null,
    });
    expect(r.titleFit).toBe(2);
  });

  it("sin ningún puesto de la persona en los hints, 0", () => {
    const r = assessPoolTitle({ ...base, title: "Data Analyst", roleHints: ["qa"] });
    expect(r.titleFit).toBe(0);
    expect(r.effectiveHints).toEqual(["qa"]);
  });

  it("el puesto vetado sale de los hints efectivos", () => {
    const r = assessPoolTitle({
      ...base,
      title: "Senior Data Engineer",
      roleHints: ["data_analyst"],
    });
    expect(r.titleFit).toBe(0);
    expect(r.effectiveHints).toEqual([]);
  });

  it("el puesto con fit 1 o 2 se queda en los hints efectivos", () => {
    const r = assessPoolTitle({ ...base, title: "Data Analyst", roleHints: ["data_analyst"] });
    expect(r.effectiveHints).toEqual(["data_analyst"]);
  });

  it("menos de 5 años: staff_plus se descarta y senior penaliza", () => {
    const staff = assessPoolTitle({
      ...base,
      title: "Staff Data Analyst",
      roleHints: ["data_analyst"],
    });
    expect(staff.tooSenior).toBe(true);
    expect(staff.seniorPenalty).toBe(0);
    const senior = assessPoolTitle({
      ...base,
      title: "Senior Data Analyst",
      roleHints: ["data_analyst"],
    });
    expect(senior.tooSenior).toBe(false);
    expect(senior.seniorPenalty).toBe(1);
  });

  it("5 años o más, o sin dato, no cambia nada", () => {
    for (const yearsTotal of [5, 12, null]) {
      const staff = assessPoolTitle({
        ...base,
        yearsTotal,
        title: "Principal Data Analyst",
        roleHints: ["data_analyst"],
      });
      expect(staff.tooSenior).toBe(false);
      expect(staff.seniorPenalty).toBe(0);
      expect(staff.level).toBe("staff_plus");
    }
  });
});
