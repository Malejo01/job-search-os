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
    ["Guild Lead"],
    ["Gerente de Ventas"],
    ["Account Executive"],
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

describe("inferRoleHints · carreras de producto (ronda 97)", () => {
  it.each([
    ["Product Manager", ["product_manager"]],
    ["Technical Product Manager", ["product_manager"]],
    ["Group Product Manager", ["product_manager"]],
    ["AI Product Manager", ["product_manager"]],
    ["Product Operations Lead", ["product_manager"]],
    ["Product Ops Specialist", ["product_manager"]],
    ["Gerente de Producto", ["product_manager"]],
    ["Jefa de Producto", ["product_manager"]],
    ["Responsable de Producto", ["product_manager"]],
    ["Product Owner", ["product_owner"]],
    ["Technical Product Owner", ["product_owner"]],
    ["Dueña de Producto", ["product_owner"]],
    ["Project Manager", ["project_manager"]],
    ["Technical Project Manager", ["project_manager"]],
    ["IT Project Manager", ["project_manager"]],
    ["Program Manager", ["project_manager"]],
    ["Delivery Manager", ["project_manager"]],
    ["Scrum Master", ["project_manager"]],
    ["Agile Coach", ["project_manager"]],
    ["PMO Analyst", ["project_manager"]],
    ["Project Coordinator", ["project_manager"]],
    ["Jefe de Proyectos", ["project_manager"]],
    ["Líder de Proyectos", ["project_manager"]],
    ["Coordinadora de Proyectos", ["project_manager"]],
    ["Gestor de Proyectos", ["project_manager"]],
    ["Product Marketing Manager", ["product_marketing"]],
    ["Go to Market Specialist", ["product_marketing"]],
    ["GTM Manager", ["product_marketing"]],
    ["Marketing de Producto", ["product_marketing"]],
    ["Product Owner / Scrum Master", ["product_owner", "project_manager"]],
    // Sin hint de producto a propósito: son datos y desarrollo (ronda 106 les da su carrera)
    ["Product Analyst", ["data_analyst"]],
    ["Product Engineer", ["fullstack"]],
    ["PO Box Clerk", []],
  ])("%s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("Product Designer sigue siendo ux_ui", () => {
    expect(hints("Product Designer")).toEqual(["ux_ui"]);
  });

  it.each([
    ["getonboard_api", "innovation-agile", ["product_manager", "product_owner", "project_manager"]],
    ["jobicy", "Product", ["product_manager", "product_owner"]],
    ["jobicy", "Project Management", ["project_manager"]],
    ["remoteok", "product", ["product_manager", "product_owner"]],
    ["remoteok", "product-manager", ["product_manager"]],
    ["remoteok", "project-manager", ["project_manager"]],
    ["wwr", "remote-product-jobs", ["product_manager", "product_owner", "project_manager"]],
    ["wwr", "product", ["product_manager", "product_owner", "project_manager"]],
  ])("categoría de %s: %s", (sourceKind, category, roles) => {
    const key = sourceKind === "remoteok" ? { tags: [category] } : { categories: [category] };
    expect(hints("Cargo sin pistas", { sourceKind, ...key })).toEqual(roles);
  });

  it("product_marketing no sale de ninguna categoría", () => {
    for (const table of Object.values(SOURCE_CATEGORY_ROLES)) {
      for (const roles of Object.values(table)) expect(roles).not.toContain("product_marketing");
    }
  });

  it("el título se suma a la categoría y no la pisa", () => {
    expect(hints("Senior Scrum Master", { sourceKind: "wwr", categories: ["product"] })).toEqual([
      "product_manager",
      "product_owner",
      "project_manager",
    ]);
  });
});

describe("inferRoleHints · puestos de carreras digitales (ronda 40)", () => {
  it.each([
    ["Digital Marketing Specialist", ["marketing_digital"]],
    ["Especialista SEO", ["marketing_digital"]],
    ["Social Media Manager", ["marketing_digital"]],
    ["Media Buyer", ["marketing_digital"]],
    ["Community Manager", ["marketing_digital"]],
    ["Recruiter", ["rrhh_it"]],
    ["Tech Recruiter", ["rrhh_it"]],
    ["Reclutadora IT", ["rrhh_it"]],
    ["Talent Acquisition Partner", ["rrhh_it"]],
    ["Analista de RRHH", ["rrhh_it"]],
    ["Customer Success Manager", ["customer_success"]],
    ["Technical Account Manager", ["customer_success"]],
    ["Cybersecurity Analyst", ["ciberseguridad"]],
    ["Analista de Ciberseguridad", ["ciberseguridad"]],
    ["Security Engineer", ["ciberseguridad"]],
    ["Pentester", ["ciberseguridad"]],
    ["DevSecOps Engineer", ["ciberseguridad"]],
  ])("%s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("no se cruzan con los puestos de siempre", () => {
    expect(hints("Product Designer")).toEqual(["ux_ui"]);
    expect(hints("Developer Relations Manager")).toEqual([]);
    expect(hints("Customer Support Representative")).toEqual([]);
    expect(hints("Atención al cliente")).toEqual([]);
    expect(hints("Security Guard")).toEqual([]);
    expect(hints("Senior Developer")).toEqual(DEV);
  });

  it.each([
    ["getonboard_api", "digital-marketing", ["marketing_digital"]],
    ["getonboard_api", "hr", ["rrhh_it"]],
    ["getonboard_api", "technical-support", ["soporte_it"]],
    ["getonboard_api", "cybersecurity", ["ciberseguridad"]],
    ["getonboard_api", "customer-support", ["customer_success"]],
    ["getonboard_api", "operations-management", ["project_manager"]],
    ["getonboard_api", "advertising-media", ["marketing_digital"]],
    ["jobicy", "Marketing", ["marketing_digital"]],
    ["jobicy", "Customer Success", ["customer_success"]],
    ["jobicy", "Recruiting", ["rrhh_it"]],
    ["remoteok", "seo", ["marketing_digital"]],
    ["remoteok", "recruiter", ["rrhh_it"]],
    ["remoteok", "cybersecurity", ["ciberseguridad"]],
  ])("categoría de %s: %s", (sourceKind, category, roles) => {
    const key = sourceKind === "remoteok" ? { tags: [category] } : { categories: [category] };
    expect(hints("Cargo sin pistas", { sourceKind, ...key })).toEqual(roles);
  });

  it("`support` suelto sigue sin mapear en Jobicy y Remote OK", () => {
    expect(hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["support"] })).toEqual(
      [],
    );
    expect(hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["support"] })).toEqual([]);
  });
});

describe("inferRoleHints · IA en el título (ronda 47c)", () => {
  it.each([
    "Gen AI Specialist",
    "ML Ops Lead",
    "AI/ML Practitioner",
    "ML AI Practitioner",
    "NLP Researcher",
    "Natural Language Processing Analyst",
    "Deep Learning Practitioner",
    "Computer Vision Practitioner",
    "Applied Scientist",
    "Research Scientist",
    "Prompt Engineer",
    "AI Agents Builder",
    "Agentic Workflow Designer",
    "LLMOps Practitioner",
  ])("término nuevo: %s", (title) => {
    expect(hints(title)).toContain("ai_engineer");
  });

  it.each([
    "AI Software Engineer",
    "Senior AI Platform Engineer",
    "ML Infrastructure Engineer",
    "AI Research Scientist",
  ])("patrón AI + rol técnico: %s", (title) => {
    expect(hints(title)).toEqual(["ai_engineer"]);
  });

  it("AI Solutions Architect es de IA y también de solutions engineering (ronda 106)", () => {
    expect(hints("AI Solutions Architect")).toEqual(["ai_engineer", "solutions_engineer"]);
  });

  it("AI + engineer no suma frontend, backend ni fullstack", () => {
    expect(hints("AI Software Engineer")).toEqual(["ai_engineer"]);
  });

  it.each(["AI Trainer", "AI Tutor", "AI Data Annotator", "AI Writing Evaluator"])(
    "entrenamiento o anotación no es ingeniería: %s",
    (title) => {
      expect(hints(title)).toEqual([]);
    },
  );

  it("AI Product Manager sigue siendo producto, sin ai_engineer", () => {
    expect(hints("AI Product Manager")).toEqual(["product_manager"]);
  });

  it("'html' no es 'ml' y 'Email Marketing Specialist' no entra", () => {
    expect(hints("HTML Developer")).toEqual(DEV);
    expect(hints("Email Marketing Specialist")).toEqual(["marketing_digital"]);
  });

  it("la lista de exclusión anula el patrón: Sales Engineer no es ai_engineer, es solutions_engineer", () => {
    expect(hints("Sales Engineer – AI platform")).toEqual(["solutions_engineer"]);
  });

  it.each(["AI Sales Specialist", "AI Customer Support Specialist", "AI Marketing Specialist"])(
    "specialist ya no es rol técnico: %s",
    (title) => {
      expect(hints(title)).not.toContain("ai_engineer");
    },
  );

  it("AI Specialist a secas ya no da ai_engineer", () => {
    expect(hints("AI Specialist")).toEqual([]);
  });

  it("AI UX Researcher es solo ux_ui; AI Researcher es ai_engineer", () => {
    expect(hints("AI UX Researcher")).toEqual(["ux_ui"]);
    expect(hints("AI Researcher")).toEqual(["ai_engineer"]);
  });

  it("el título manda cuando categoría + título superan el máximo", () => {
    expect(
      hints("AI Developer", {
        sourceKind: "jobicy",
        categories: ["programming", "data-science-analytics"],
      }),
    ).toEqual(["ai_engineer"]);
    // Sin roles en el título sigue siendo "sin señal"
    expect(
      hints("Cargo sin pistas", {
        sourceKind: "jobicy",
        categories: ["programming", "data-science-analytics", "web-app-design"],
      }),
    ).toEqual([]);
  });
});

describe("inferRoleHints · categorías nuevas de Jobicy (ronda 47c)", () => {
  it.each([
    ["Programming", DEV],
    ["Software Development", DEV],
    ["Web Development", DEV],
    ["Web & App Design", ["ux_ui"]],
    ["Data Science & Analytics", ["data_analyst"]],
    ["DevOps & Infrastructure", ["soporte_it"]],
    ["HR & Recruiting", ["rrhh_it"]],
    ["Machine Learning", ["ai_engineer"]],
    ["Artificial Intelligence", ["ai_engineer"]],
    ["AI/ML", ["ai_engineer"]],
    ["AI", ["ai_engineer"]],
  ])("%s", (category, roles) => {
    expect(hints("Cargo sin pistas", { sourceKind: "jobicy", categories: [category] })).toEqual(
      roles,
    );
  });

  it("customer-support no se mapea", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["Customer Support"] }),
    ).toEqual([]);
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

  it.each([
    ["remote-programming-jobs", ["frontend", "backend", "fullstack"]],
    ["remote-full-stack-programming-jobs", ["fullstack"]],
    ["remote-back-end-programming-jobs", ["backend"]],
    ["remote-front-end-programming-jobs", ["frontend"]],
    ["remote-devops-sysadmin-jobs", ["soporte_it"]],
    ["remote-product-jobs", ["product_manager", "product_owner", "project_manager"]],
    ["remote-customer-support-jobs", ["customer_success"]],
    ["remote-design-jobs", ["ux_ui"]],
    ["Full-Stack Programming", ["fullstack"]],
    ["DevOps and Sysadmin", ["soporte_it"]],
  ])("WWR: categoría %s", (category, roles) => {
    expect(hints("Cargo sin pistas", { sourceKind: "wwr", categories: [category] })).toEqual(roles);
    expect(hints("Cargo sin pistas", { sourceKind: "wwr", tags: [category] })).toEqual(roles);
  });

  it("los ATS no tienen mapa de categorías: infieren por título", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "greenhouse", categories: ["Engineering"] }),
    ).toEqual([]);
    expect(hints("Product Manager", { sourceKind: "lever", categories: ["Engineering"] })).toEqual([
      "product_manager",
    ]);
  });

  it("la tabla de una fuente no se aplica a otra", () => {
    expect(
      hints("Cargo sin pistas", { sourceKind: "jobicy", categories: ["mobile-developer"] }),
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
      hints("Cargo sin pistas", { sourceKind: "remoteok", tags: ["sales", "finance"] }),
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

describe("inferRoleHints · reglas para tech sin carrera (ronda 106, ADR-021)", () => {
  it.each([
    ["Site Reliability Engineer", ["soporte_it"]],
    ["Senior SRE", ["soporte_it"]],
    ["DevOps Engineer", ["soporte_it"]],
    ["GitOps Engineer", ["soporte_it"]],
    ["Platform Engineer", ["soporte_it"]],
    ["Infrastructure Engineer", ["soporte_it"]],
    ["Infra Engineer", ["soporte_it"]],
    ["IT Engineer", ["soporte_it"]],
    ["IT Systems Administrator", ["soporte_it"]],
    ["IT Operations Analyst", ["soporte_it"]],
    ["Desktop Support Technician", ["soporte_it"]],
    ["Software Support Engineer", ["soporte_it"]],
    ["Database Support Engineer", ["soporte_it"]],
    ["Application Support Engineer", ["soporte_it"]],
  ])("soporte_it: %s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("support engineer suelto o de producto no es soporte de IT", () => {
    expect(hints("Support Engineer")).toEqual([]);
    expect(hints("Customer Support Engineer")).toEqual([]);
    expect(hints("Product Support Engineer")).toEqual([]);
  });

  it("la infraestructura de IA no es soporte de IT", () => {
    expect(hints("AI Platform Engineer")).toEqual(["ai_engineer"]);
    expect(hints("ML Infrastructure Engineer")).toEqual(["ai_engineer"]);
  });

  it.each([
    ["Security Operations Analyst", ["ciberseguridad"]],
    ["Security Architect", ["ciberseguridad"]],
    ["Security Researcher", ["ciberseguridad"]],
    ["Security Infrastructure Engineer", ["ciberseguridad"]],
    ["Security Governance Lead", ["ciberseguridad"]],
    ["Security Risk Engineer", ["ciberseguridad"]],
    ["Threat Intelligence Analyst", ["ciberseguridad"]],
    ["Red Team Operator", ["ciberseguridad"]],
    ["Incident Response Engineer", ["ciberseguridad"]],
    ["Cyber Defense Analyst", ["ciberseguridad"]],
    ["Cyberdefense Analyst", ["ciberseguridad"]],
  ])("ciberseguridad: %s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("seguridad física y de data center no es ciberseguridad", () => {
    expect(hints("Physical Security Engineer")).toEqual([]);
    expect(hints("Physical Security Architect")).toEqual([]);
    expect(hints("Data Center Security Engineer")).toEqual([]);
    expect(hints("Security Guard")).toEqual([]);
  });

  it.each([
    ["Rust Engineer", ["backend"]],
    ["Senior Elixir Engineer", ["backend"]],
    ["Scala Engineer", ["backend"]],
    ["Kotlin Engineer", ["backend"]],
    ["Golang Engineer", ["backend"]],
    ["Postgres Engineer", ["backend"]],
    ["Microservices Engineer", ["backend"]],
    ["Distributed Systems Engineer", ["backend"]],
    ["Software Architect", ["backend"]],
  ])("backend: %s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("un lenguaje sin 'engineer' no suma backend por sí solo", () => {
    expect(hints("Rust Evangelist")).toEqual([]);
    expect(hints("Solutions Architect")).toEqual(["solutions_engineer"]);
  });

  it("product engineer es fullstack, salvo manufactura, hardware o mecánica", () => {
    expect(hints("Product Engineer")).toEqual(["fullstack"]);
    expect(hints("Senior Product Engineer")).toEqual(["fullstack"]);
    expect(hints("Manufacturing Product Engineer")).toEqual([]);
    expect(hints("Hardware Product Engineer")).toEqual([]);
    expect(hints("Mechanical Product Engineer")).toEqual([]);
    expect(hints("Product Engineer, Manufacturing")).toEqual([]);
  });

  it("la exclusión de hardware aplica solo a 'product engineer', no a full stack", () => {
    expect(hints("Full Stack Engineer, Hardware Platform")).toEqual(["fullstack"]);
    expect(hints("Fullstack Developer - Manufacturing Software")).toEqual(["fullstack"]);
    expect(hints("Product Engineer")).toEqual(["fullstack"]);
  });

  it("cyber es una lista cerrada, no un prefijo", () => {
    expect(hints("Cyber Monday Marketing Manager")).not.toContain("ciberseguridad");
    expect(hints("Cyberdefense Analyst")).toContain("ciberseguridad");
    expect(hints("Cyber Security Engineer")).toContain("ciberseguridad");
    expect(hints("Cyber Threat Hunter")).toContain("ciberseguridad");
    expect(hints("Cyber Risk Manager")).toContain("ciberseguridad");
    expect(hints("Cyber Engineer")).toContain("ciberseguridad");
  });

  it("research engineer es ai_engineer; research analyst no", () => {
    expect(hints("Research Engineer")).toEqual(["ai_engineer"]);
    expect(hints("Research Analyst")).toEqual([]);
  });

  it("data scientist y product analyst son data_analyst; business analyst no", () => {
    expect(hints("Data Scientist")).toEqual(["data_analyst"]);
    expect(hints("Product Analyst")).toEqual(["data_analyst"]);
    expect(hints("Business Analyst")).toEqual([]);
  });

  it("mobile y 'engineer' genérico no se tocan", () => {
    expect(hints("Android Engineer")).toEqual([]);
    expect(hints("iOS Engineer")).toEqual([]);
    expect(hints("Staff Engineer")).toEqual([]);
    expect(hints("Engineer")).toEqual([]);
    expect(hints("iOS Developer")).toEqual(DEV);
  });

  it("engineering manager no tiene carrera", () => {
    expect(hints("Engineering Manager")).toEqual([]);
  });
});

describe("inferRoleHints · data_engineer y solutions_engineer (ronda 106, ADR-021)", () => {
  it.each([
    ["Data Engineer", ["data_engineer"]],
    ["Senior Data Engineer", ["data_engineer"]],
    ["Big Data Engineer", ["data_engineer"]],
    ["Analytics Engineer", ["data_engineer"]],
    ["Data Platform Engineer", ["data_engineer"]],
    ["ETL Developer", ["data_engineer"]],
    ["Ingeniero de Datos", ["data_engineer"]],
    ["Ingeniera de Datos Senior", ["data_engineer"]],
  ])("data_engineer: %s (y no cae en data_analyst)", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("data analyst sigue siendo data_analyst, sin data_engineer", () => {
    expect(hints("Data Analyst")).toEqual(["data_analyst"]);
    expect(hints("Analista de Datos")).toEqual(["data_analyst"]);
  });

  it.each([
    ["Solutions Engineer", ["solutions_engineer"]],
    ["Senior Solutions Architect", ["solutions_engineer"]],
    ["Sales Engineer", ["solutions_engineer"]],
    ["Pre-Sales Consultant Engineer", ["solutions_engineer"]],
    ["Presales Engineer", ["solutions_engineer"]],
    ["Forward Deployed Engineer", ["solutions_engineer"]],
    ["Software Field Engineer", ["solutions_engineer"]],
    ["Customer Field Engineer", ["solutions_engineer"]],
    ["Professional Services Engineer", ["solutions_engineer"]],
    ["Professional Services Consultant", ["solutions_engineer"]],
    ["Ingeniero de Preventa", ["solutions_engineer"]],
  ])("solutions_engineer: %s", (title, roles) => {
    expect(hints(title)).toEqual(roles);
  });

  it("field engineer suelto, ventas y gerencia no son solutions_engineer", () => {
    expect(hints("Field Engineer")).toEqual([]);
    expect(hints("Field Service Engineer")).toEqual([]);
    expect(hints("Sales Manager")).toEqual([]);
    expect(hints("Account Executive")).toEqual([]);
    expect(hints("Solutions Manager")).toEqual([]);
  });

  it("las categorías de la fuente no marcan las carreras nuevas", () => {
    for (const table of Object.values(SOURCE_CATEGORY_ROLES)) {
      for (const roles of Object.values(table)) {
        expect(roles).not.toContain("data_engineer");
        expect(roles).not.toContain("solutions_engineer");
      }
    }
  });
});
