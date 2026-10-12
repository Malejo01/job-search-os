import { describe, expect, it } from "vitest";
import { inferRoleHints, SOURCE_CATEGORY_ROLES } from "./role-hints";
import { ROLE_KEYS } from "./self-assessment";

const hints = (
  title: string,
  extra: { sourceKind?: string; tags?: string[]; categories?: string[] } = {},
) =>
  inferRoleHints({
    sourceKind: extra.sourceKind ?? "other",
    title,
    tags: extra.tags,
    categories: extra.categories,
  });

const DEV = ["frontend", "backend", "fullstack"];

describe("inferRoleHints · título", () => {
  it.each([
    ["QA Engineer", ["qa"]],
    ["Analista QA Automation", ["qa"]],
    ["Tester de software", ["qa"]],
    ["Quality Assurance Analyst", ["qa"]],
    ["UX/UI Designer", ["ux_ui"]],
    ["Product Designer", ["ux_ui"]],
    ["Diseñadora UX", ["ux_ui"]],
    ["Diseñador de producto", ["ux_ui"]],
    ["Analista de soporte técnico", ["soporte_it"]],
    ["IT Support Specialist", ["soporte_it"]],
    ["Mesa de ayuda N1", ["soporte_it"]],
    ["Service Desk Analyst", ["soporte_it"]],
    ["SysAdmin Linux", ["soporte_it"]],
    ["Data Analyst", ["data_analyst"]],
    ["Analista de datos", ["data_analyst"]],
    ["BI Analyst", ["data_analyst"]],
    ["Business Intelligence Developer", ["data_analyst"]],
    ["AI Engineer", ["ai_engineer"]],
    ["Machine Learning Engineer", ["ai_engineer"]],
    ["Ingeniero de IA", ["ai_engineer"]],
    ["LLM Engineer", ["ai_engineer"]],
    ["Frontend Developer", ["frontend"]],
    ["Desarrollador Front-End React", ["frontend"]],
    ["Angular Engineer", ["frontend"]],
    ["Backend Developer", ["backend"]],
    ["Desarrollador Back-End Java", ["backend"]],
    ["Node.js Engineer", ["backend"]],
    ["Python Developer", ["backend"]],
    ["Full Stack Engineer", ["fullstack"]],
    ["Fullstack Developer", ["fullstack"]],
    ["Desarrollador Full Stack", ["fullstack"]],
  ])("%s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it.each([
    ["Software Engineer"],
    ["Senior Developer"],
    ["Desarrollador de software"],
    ["Desarrolladora Senior"],
  ])("%s sirve a los tres roles de desarrollo", (title) => {
    expect(hints(title)).toEqual(DEV);
  });

  it("un rol específico gana sobre la palabra genérica developer", () => {
    expect(hints("AI Developer")).toEqual(["ai_engineer"]);
    expect(hints("Backend Developer")).toEqual(["backend"]);
    expect(hints("QA Developer")).toEqual(["qa"]);
  });

  it("puede devolver más de un rol", () => {
    expect(hints("Frontend and Backend Developer")).toEqual(["frontend", "backend"]);
    expect(hints("QA y Soporte IT")).toEqual(["qa", "soporte_it"]);
  });

  it.each([
    ["Building Manager"],
    ["Social Media Manager"],
    ["Guild Lead"],
    ["Media Buyer"],
    ["Gerente de Ventas"],
    ["Account Executive"],
    ["Recruiter"],
    ["Quality Manager"],
    ["Biologist"],
    ["Business Developer"],
  ])("falso positivo que no marca: %s", (title) => {
    expect(hints(title)).toEqual([]);
  });

  it("sin señales devuelve vacío", () => {
    expect(hints("")).toEqual([]);
    expect(hints("Contador")).toEqual([]);
    expect(inferRoleHints({ sourceKind: "other", title: "Contador" })).toEqual([]);
  });

  it("ignora mayúsculas y acentos", () => {
    expect(hints("DESARROLLADOR BACKEND")).toEqual(["backend"]);
    expect(hints("Técnico de Soporte")).toEqual(["soporte_it"]);
    expect(hints("Soporte Técnico N2")).toEqual(["soporte_it"]);
  });

  it.each([
    "Técnico de Soporte",
    "Tecnico de soporte N1",
    "Analista de Soporte Informático",
    "Soporte de Sistemas",
    "Técnico en Sistemas",
    "Técnico Informático",
  ])("soporte de IT en castellano, con y sin acento: %s", (title) => {
    expect(hints(title)).toEqual(["soporte_it"]);
  });

  it("atención al cliente no es soporte de IT", () => {
    expect(hints("Customer Support Representative")).toEqual([]);
    expect(hints("Support Specialist")).toEqual([]);
    expect(hints("Soporte al cliente")).toEqual([]);
    expect(hints("Technical Support Engineer")).toEqual(["soporte_it"]);
    expect(hints("Analista de Soporte IT")).toEqual(["soporte_it"]);
  });

  it("developer advocate y developer relations no son desarrollo", () => {
    expect(hints("Developer Advocate")).toEqual([]);
    expect(hints("Developer Relations Manager")).toEqual([]);
    expect(hints("Senior Developer")).toEqual(DEV);
  });
});

describe("inferRoleHints · categorías de la fuente", () => {
  it("Get on Board: programming y mobile-developer dan desarrollo", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "getonboard_api", categories: ["programming"] }),
    ).toEqual(DEV);
    expect(
      hints("Cargo sin pistas", { sourceKind: "getonboard_api", categories: ["mobile-developer"] }),
    ).toEqual(DEV);
  });

  it.each([
    ["machine-learning-ai", ["ai_engineer"]],
    ["data-science-analytics", ["data_analyst"]],
    ["design-ux", ["ux_ui"]],
    ["sysadmin-devops-qa", ["qa", "soporte_it"]],
    ["customer-support", []],
  ])("Get on Board: %s", (category, roles) => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "getonboard_api", categories: [category] }),
    ).toEqual(roles);
  });

  it("Get on Board: una categoría desconocida no marca nada", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "getonboard_api", categories: ["sales-business"] }),
    ).toEqual([]);
  });

  it("Jobicy: normaliza a minúsculas y guiones", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Engineering"] }),
    ).toEqual(DEV);
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Design & Multimedia"] }),
    ).toEqual(["ux_ui"]);
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Design-Multimedia"] }),
    ).toEqual(["ux_ui"]);
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Data Science"] }),
    ).toEqual(["data_analyst"]);
    expect(hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Dev Ops"] })).toEqual([
      "soporte_it",
    ]);
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Technical Support"] }),
    ).toEqual(["soporte_it"]);
    expect(hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["QA"] })).toEqual(["qa"]);
  });

  it("la tabla de una fuente no se aplica a otra", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["programming"] }),
    ).toEqual([]);
    expect(hints("Cargo sin pistas", { sourceKind: "other", categories: ["programming"] })).toEqual(
      [],
    );
  });

  it("Remote OK: usa los tags", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["react", "javascript"] }),
    ).toEqual(DEV);
    expect(hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["design", "ux"] })).toEqual([
      "ux_ui",
    ]);
    expect(hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["qa", "testing"] })).toEqual([
      "qa",
    ]);
    expect(
      hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["Customer Support", "support"] }),
    ).toEqual([]);
    expect(hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["sysadmin"] })).toEqual([
      "soporte_it",
    ]);
    expect(hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["sql", "analyst"] })).toEqual(
      ["data_analyst"],
    );
    expect(
      hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["Machine Learning", "llm"] }),
    ).toEqual(["ai_engineer"]);
  });

  it("Remote OK: un tag desconocido no marca nada", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["marketing", "sales"] }),
    ).toEqual([]);
  });

  it("combina título y categoría sin repetir y en el orden de ROLE_KEYS", () => {
    const out = hints("Data Analyst", {
      sourceKind: "getonboard_api",
      categories: ["programming"],
    });
    expect(out).toEqual(["frontend", "backend", "fullstack", "data_analyst"]);
    expect(new Set(out).size).toBe(out.length);
    const order = out.map((r) => ROLE_KEYS.indexOf(r));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("más de 4 roles = sin señal (vacío); con 4 todavía cuenta", () => {
    // 3 de desarrollo + data + ux = 5 roles
    expect(
      hints("Cargo sin pistas", {
        sourceKind: "remoteok",
        tags: ["react", "sql", "design"],
      }),
    ).toEqual([]);
    // 3 de desarrollo + data = 4 roles
    expect(hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["react", "sql"] })).toEqual([
      "frontend",
      "backend",
      "fullstack",
      "data_analyst",
    ]);
  });

  it("todos los roles de la tabla son ROLE_KEYS", () => {
    for (const table of Object.values(SOURCE_CATEGORY_ROLES)) {
      for (const roles of Object.values(table)) {
        for (const role of roles) expect(ROLE_KEYS).toContain(role);
      }
    }
  });
});
