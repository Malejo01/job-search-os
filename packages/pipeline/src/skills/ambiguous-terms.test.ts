import { describe, expect, it } from "vitest";
import taxonomy from "../../../db/seeds/skills.json";
import { compileTaxonomy, extractJdSkills, extractSkillsFromText } from "./match";

/**
 * R11-9: una skill necesita evidencia en el texto. Términos ambiguos (growth, identity, make,
 * security, go...) cuentan en una JD solo con contexto. Todo inventado.
 */

const terms = compileTaxonomy(taxonomy);
const jd = (text: string) => extractJdSkills(text, terms);

describe("avisos de nómina y contables: nada de Growth, IAM, n8n ni multimodal", () => {
  const payroll = `Empresa A busca Analista de Nómina. Vas a liquidar sueldos, controlar la seguridad social
    y apoyar el crecimiento de la compañía. Company growth is a priority and we value our company vision.
    Make sure every payroll run closes on time. Strong communication with stakeholders. Our brand identity
    is warm. Marketing team sits next door. Excelente ambiente: seguridad laboral garantizada.`;

  it("el aviso sí nombra nómina", () => {
    expect(jd(payroll)).toContain("payroll");
  });

  it.each(["growth_marketing", "iam", "n8n", "multimodal", "security", "client_facing", "go"])(
    "no suma %s",
    (slug) => {
      expect(jd(payroll)).not.toContain(slug);
    },
  );

  it("antes de R11-9 el mismo texto sí traía esas skills sin nombrarlas (control)", () => {
    const before = extractSkillsFromText(payroll, terms);
    expect(before).toEqual(expect.arrayContaining(["growth_marketing", "iam", "n8n"]));
  });
});

describe("Renewals Manager de software: ni IAM ni Propiedad intelectual", () => {
  const renewals = `Renewals Manager at Empresa B. Own the renewal cycle for our SaaS customers.
    You will protect the company's intellectual property and trademarks in all communications.
    We take our identity as a team seriously. Work with customer success on churn.`;

  it("no suma iam ni ip_law", () => {
    const slugs = jd(renewals);
    expect(slugs).not.toContain("iam");
    expect(slugs).not.toContain("ip_law");
  });

  it("sí conserva lo que el aviso dice", () => {
    expect(jd(renewals)).toContain("churn_retention");
  });
});

describe("palabras ambiguas con contexto: sí cuentan", () => {
  it("growth con marketing, adquisición o experimentos", () => {
    expect(jd("Growth marketing manager for paid acquisition")).toContain("growth_marketing");
    expect(jd("Lead growth experiments and A/B tests")).toContain("growth_marketing");
    expect(jd("Customer growth and retention")).toContain("growth_marketing");
  });

  it("marketing con actividad de marketing, no el departamento", () => {
    expect(jd("Digital marketing specialist")).toContain("growth_marketing");
    expect(jd("Marketing campaigns and analytics")).toContain("growth_marketing");
    expect(jd("Coordinate with the marketing department on invoices")).not.toContain(
      "growth_marketing",
    );
  });

  it("identity con gestión de identidades y acceso", () => {
    expect(jd("Identity and access management with Okta")).toContain("iam");
    expect(jd("Identity governance (SailPoint)")).toContain("iam");
    expect(jd("Brand identity guidelines")).not.toContain("iam");
  });

  it("make con herramientas de automatización", () => {
    expect(jd("Automations in Zapier, Make or n8n")).toContain("n8n");
    expect(jd("Build scenarios in Make.com")).toContain("n8n");
    expect(jd("We make decisions fast")).not.toContain("n8n");
  });

  it("vision con modelos o imagen, no la visión de la empresa", () => {
    expect(jd("Experience with vision models for image tasks")).toContain("multimodal");
    expect(jd("Our vision is to be the best")).not.toContain("multimodal");
  });

  it("propiedad intelectual con contexto legal", () => {
    expect(jd("Abogado de propiedad intelectual: registro de marcas y patentes")).toContain(
      "ip_law",
    );
    expect(jd("IP attorney: trademark registration and litigation")).toContain("ip_law");
    expect(jd("Respect confidentiality and intellectual property rights")).not.toContain("ip_law");
  });

  it("security: ciberseguridad sí, seguridad social no", () => {
    expect(jd("Cloud security and threat modeling")).toContain("security");
    expect(jd("Seguridad de la información (ISO 27001)")).toContain("security");
    expect(jd("Aportes de seguridad social y job security")).not.toContain("security");
  });

  it("go (lenguaje) no sale de go-to-market ni de 'go above'", () => {
    expect(jd("Backend in Go and Python")).toContain("go");
    expect(jd("Golang services")).toContain("go");
    expect(jd("Stack: Go, Kubernetes, Docker, gRPC")).toContain("go");
    expect(jd("Requisitos: Go, Postgres, microservicios")).toContain("go");
    expect(jd("Go-to-market plan, go above and beyond")).not.toContain("go");
  });

  it("communication y stakeholders solo si hablan de clientes o no técnicos", () => {
    expect(jd("Explain trade-offs to non-technical stakeholders")).toContain("client_facing");
    expect(jd("Strong communication skills")).not.toContain("client_facing");
  });

  it("next, rest, spring, lambda, glue: palabras comunes", () => {
    expect(jd("Next steps and the rest of the team in spring")).toEqual([]);
    expect(jd("Next.js with React")).toContain("nextjs");
    expect(jd("REST API design")).toContain("rest_apis");
    expect(jd("Spring Boot services in Java")).toContain("java");
    expect(jd("Be the glue between teams")).not.toContain("aws");
  });

  it("distributed team no es sistemas distribuidos", () => {
    expect(jd("We are a distributed team")).not.toContain("microservices");
    expect(jd("Experience with distributed systems")).toContain("microservices");
  });

  it("outlook y native: inglés y correo", () => {
    expect(jd("Positive economic outlook")).not.toContain("office_suite");
    expect(jd("Manage Outlook email and calendar")).toContain("office_suite");
    expect(jd("Native English speaker")).toContain("english_fluent");
    expect(jd("Cloud native apps")).not.toContain("english_fluent");
  });
});

describe("contratos que no cambian", () => {
  it("extractSkillsFromText sin la opción sigue siendo el de siempre", () => {
    expect(extractSkillsFromText("Growth", terms)).toContain("growth_marketing");
    expect(extractSkillsFromText("Identity", terms)).toContain("iam");
  });

  it("los slugs no cambian: cada regla apunta a un slug que existe", () => {
    const slugs = new Set(taxonomy.map((s) => s.slug));
    for (const slug of [
      "growth_marketing",
      "iam",
      "n8n",
      "multimodal",
      "ip_law",
      "security",
      "go",
      "client_facing",
    ]) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});
