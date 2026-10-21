import { describe, expect, it } from "vitest";
import skills from "../../../db/seeds/skills.json";
import { compileTaxonomy, extractSkillsFromText, normalizeMention } from "./match";

type Entry = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  closure_hours: number;
  description: string;
};
const taxonomy = skills as Entry[];

const NEW_SLUGS = [
  "figma",
  "ux_research",
  "design_systems",
  "prototyping",
  "redes_it",
  "windows_server",
  "linux_admin",
  "active_directory",
  "itil",
  "help_desk",
  "excel",
  "power_bi",
  "tableau",
  "statistics",
];
/** Skills de la ronda 78 (herramientas que faltaban): también se excluyen de "no cambia". */
const R78_SLUGS = ["git", "canva", "capcut", "notion", "trello", "mailchimp"];
/** Skills de la ronda 97 (carreras de producto): también se excluyen de "no cambia". */
const R97_SLUGS = [
  "go_to_market",
  "positioning_messaging",
  "market_research",
  "user_stories",
  "project_planning",
  "risk_management",
  "pm_certifications",
];
/** Skills de la ronda 40 (carreras digitales), de la 78 y de la 97: se excluyen de la comparación de "no cambia". */
const CAREER_SLUGS = new Set([
  ...R78_SLUGS,
  ...R97_SLUGS,
  "google_ads",
  "meta_ads",
  "ga4",
  "email_marketing",
  "copywriting",
  "social_media",
  "product_management",
  "scrum_agile",
  "jira",
  "roadmap",
  "product_discovery",
  "sourcing",
  "interviewing",
  "ats",
  "employer_branding",
  "linkedin_recruiter",
  "hubspot",
  "customer_onboarding",
  "churn_retention",
]);
const CATEGORIES = ["dominio", "infra", "datos"];
const ALLOWED_CATEGORY = new Set([
  "cloud",
  "infra",
  "testing",
  "llm_ops",
  "ai_core",
  "lenguaje",
  "framework",
  "datos",
  "soft",
  "idioma",
  "dominio",
  "otra",
]);

const extract = (text: string, tax: readonly Entry[] = taxonomy) =>
  extractSkillsFromText(text, compileTaxonomy(tax)).sort();

describe("skills.json: integridad", () => {
  it("slugs únicos y categoría válida", () => {
    const slugs = taxonomy.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of taxonomy) expect(ALLOWED_CATEGORY.has(s.category), s.slug).toBe(true);
  });

  it("ningún alias es tan corto que matchee de más (menos de 4 letras solo si está en la lista)", () => {
    // Siglas conocidas e inequívocas; un alias corto nuevo se suma acá a conciencia.
    const shortOk = new Set([
      // nuevas de esta ronda
      "dns",
      "lan",
      "wan",
      "gpo",
      "vpn",
      "vba",
      "dax",
      // ya existían
      "s3",
      "ts",
      "c#",
      "eks",
      "aks",
      "gke",
      "k8s",
      "sst",
      "cdk",
      "e2e",
      "tdd",
      "dpo",
      "a2a",
      "acp",
      "iga",
      "sod",
      "ddd",
      "bff",
      "ssr",
      "isr",
      "cro",
      "gtm",
      "ga4",
      "crm",
      "lex",
      "cxe",
      "jwt",
      "ec2",
      "gcp",
      "jax",
      "etl",
      "net",
      // ronda 97: siglas de certificaciones y de planificación, inequívocas en una JD
      "pmp",
      "psm",
      "wbs",
    ]);
    for (const s of taxonomy) {
      for (const a of s.aliases) {
        const n = normalizeMention(a);
        if (n.length < 4) expect(shortOk.has(n), `${s.slug}: ${a}`).toBe(true);
      }
    }
  });

  it("dos skills distintas no comparten ningún término (slug, nombre o alias)", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const s of taxonomy) {
      const terms = new Set(
        [s.slug.replace(/_/g, " "), s.name, ...s.aliases].map(normalizeMention),
      );
      for (const t of terms) {
        const prev = owner.get(t);
        if (prev && prev !== s.slug) clashes.push(`"${t}": ${prev} / ${s.slug}`);
        owner.set(t, s.slug);
      }
    }
    // Colisiones heredadas de antes de esta ronda (se resuelven por orden de término, no se tocan acá)
    const inherited = new Set([
      `"eks": aws / kubernetes`,
      `"aks": azure / kubernetes`,
      // "gtm" en seo es Google Tag Manager; en la 97 pasó a go_to_market y salió de growth_marketing
      `"gtm": seo / go_to_market`,
    ]);
    expect(clashes.filter((c) => !inherited.has(c))).toEqual([]);
  });
});

describe("skills.json: descripciones (ronda 78)", () => {
  it("todas tienen una frase de hasta 140 caracteres, sin saltos de línea", () => {
    for (const s of taxonomy) {
      expect(typeof s.description, s.slug).toBe("string");
      expect(s.description.trim().length, s.slug).toBeGreaterThan(10);
      expect(s.description.length, `${s.slug}: ${s.description.length}`).toBeLessThanOrEqual(140);
      expect(s.description, s.slug).not.toMatch(/[\r\n<>]/);
    }
  });
});

describe("skills de la ronda 78: Git, Canva, CapCut, Notion, Trello y Mailchimp", () => {
  const find = (slug: string) => taxonomy.find((s) => s.slug === slug);

  it("están todas, con categoría existente", () => {
    for (const slug of R78_SLUGS) {
      expect(find(slug), slug).toBeDefined();
      expect(ALLOWED_CATEGORY.has(find(slug)!.category), slug).toBe(true);
    }
  });

  it("Git se llama «Git / GitHub» y tiene los aliases github, gitlab y bitbucket", () => {
    expect(find("git")!.name).toBe("Git / GitHub");
    expect(find("git")!.aliases).toEqual(expect.arrayContaining(["github", "gitlab", "bitbucket"]));
  });

  it("mailchimp sale de los aliases de email_marketing", () => {
    expect(find("email_marketing")!.aliases).not.toContain("mailchimp");
  });

  it.each([
    ["git", "Experiencia con Git y GitHub para el control de versiones."],
    ["git", "Manejo de Bitbucket o GitLab."],
    ["canva", "Diseño de piezas en Canva."],
    ["capcut", "Edición de reels con CapCut."],
    ["notion", "Documentación en Notion."],
    ["trello", "Seguimiento de tareas en Trello."],
    ["mailchimp", "Campañas en Mailchimp."],
  ])("detecta %s en: %s", (slug, text) => {
    expect(extract(text)).toContain(slug);
  });

  it("«GitHub Actions» sigue siendo CI/CD y no suma Git", () => {
    const found = extract("Pipelines con GitHub Actions.");
    expect(found).toContain("ci_cd");
    expect(found).not.toContain("git");
  });

  it("mailchimp ya no cuenta como email_marketing", () => {
    expect(extract("Campañas en Mailchimp.")).not.toContain("email_marketing");
  });
});

describe("skills de la ronda 97: carreras de producto", () => {
  const find = (slug: string) => taxonomy.find((s) => s.slug === slug);

  it("están las 7, en categoría dominio, con descripción", () => {
    for (const slug of R97_SLUGS) {
      expect(find(slug), slug).toBeDefined();
      expect(find(slug)!.category, slug).toBe("dominio");
    }
  });

  it("gtm es alias de go_to_market y ya no de growth_marketing", () => {
    expect(find("go_to_market")!.aliases).toContain("gtm");
    expect(find("growth_marketing")!.aliases).not.toContain("gtm");
  });

  it.each([
    ["go_to_market", "Plan de go-to-market y lanzamientos de producto."],
    ["positioning_messaging", "Definir la propuesta de valor y el product positioning."],
    ["market_research", "Realizar competitive analysis e investigación de mercado."],
    ["user_stories", "Escribir user stories y mantener el product backlog."],
    ["project_planning", "Cronograma en MS Project y diagramas de Gantt."],
    ["risk_management", "Gestión de riesgos y gestión del alcance."],
    ["pm_certifications", "Certificación PMP o PSM deseable."],
  ])("detecta %s en: %s", (slug, text) => {
    expect(extract(text)).toContain(slug);
  });

  it("'messaging' suelto (colas de mensajes) no marca posicionamiento", () => {
    expect(extract("Sistemas de messaging con Kafka y RabbitMQ.")).not.toContain(
      "positioning_messaging",
    );
  });
});

describe("skills nuevas: UX/UI, soporte IT y datos", () => {
  const added = taxonomy.filter((s) => NEW_SLUGS.includes(s.slug));

  it("están todas, con categoría existente y horas razonables", () => {
    expect(added.map((s) => s.slug).sort()).toEqual([...NEW_SLUGS].sort());
    for (const s of added) {
      expect(CATEGORIES, s.slug).toContain(s.category);
      expect(s.closure_hours, s.slug).toBeGreaterThan(0);
      expect(s.closure_hours, s.slug).toBeLessThanOrEqual(40);
    }
  });

  const cases: [string, string][] = [
    ["figma", "Design components in Figma and hand off to engineers."],
    ["ux_research", "Conducirás user research y entrevistas a usuarios."],
    ["design_systems", "Mantener nuestro design system y la librería de componentes."],
    ["prototyping", "Wireframes and interactive prototypes for each feature."],
    ["accessibility", "Cumplir con la accesibilidad web y las pautas WCAG 2.2."],
    ["redes_it", "Conocimientos de TCP/IP, DNS, DHCP y VPN."],
    ["redes_it", "Administración de redes LAN y equipos Cisco."],
    ["windows_server", "Experiencia con Windows Server 2019 y GPO."],
    ["linux_admin", "Administración de servidores Linux (Ubuntu, Red Hat) y bash."],
    ["active_directory", "Alta y baja de usuarios en Active Directory."],
    ["itil", "Certificación ITIL 4 deseable."],
    ["help_desk", "Atención en la mesa de ayuda con Zendesk o GLPI."],
    ["help_desk", "Service desk analyst, ticketing y soporte técnico de nivel 1."],
    ["excel", "Excel avanzado: tablas dinámicas y BUSCARV."],
    ["power_bi", "Dashboards en Power BI con DAX."],
    ["tableau", "Reportes en Tableau o Looker Studio."],
    ["statistics", "Conocimientos de estadística y análisis estadístico."],
    ["statistics", "Solid statistics background."],
  ];
  it.each(cases)("detecta %s en: %s", (slug, text) => {
    expect(extract(text)).toContain(slug);
  });

  it("cada skill nueva tiene al menos un caso de detección", () => {
    const covered = new Set(cases.map(([slug]) => slug));
    for (const slug of NEW_SLUGS) expect(covered.has(slug), slug).toBe(true);
  });

  const falsePositives: [string, string][] = [
    ["excel", "We value excellent communication skills."],
    ["excel", "Buscamos una persona con excelente trato."],
    ["redes_it", "Attend networking events and meetups."],
    ["redes_it", "Manejo de redes sociales de la marca."],
    ["power_bi", "Reviews happen on a BI-weekly cadence."],
    ["figma", "Our office has a great view."],
    ["itil", "Daily stand-ups with the team."],
    ["help_desk", "Our desk is open to everyone."],
    ["active_directory", "Reports to the active director of sales."],
    ["linux_admin", "Familiarity with the Windows desktop."],
  ];
  it.each(falsePositives)("no marca %s en: %s", (slug, text) => {
    expect(extract(text)).not.toContain(slug);
  });

  it.each([
    ["linux_admin", "Backend role: Linux and bash scripting."],
    ["design_systems", "Storybook"],
    ["active_directory", "LDAP"],
    ["help_desk", "ticketing system"],
    ["linux_admin", "Run the bash script, then enjoy the Linux kernel talk."],
    ["design_systems", "We publish a Storybook and a component library."],
    ["prototyping", "Ship a prototype of the new flow."],
    ["active_directory", "Query the LDAP server."],
    ["help_desk", "Open a ticket; ticketing is handled elsewhere."],
  ])("alias retirado por ambiguo: %s no matchea en: %s", (slug, text) => {
    expect(extract(text)).not.toContain(slug);
  });

  // Riesgos conocidos, documentados a propósito (no usar .fails): el match es por palabra entera y
  // no distingue sentido. TODO: desambiguar en match.ts (p. ej. verbo "excel at" o contexto).
  it("riesgo conocido: 'rapid prototyping' matchea prototyping por el término del slug", () => {
    expect(extract("Experience with rapid prototyping.")).toContain("prototyping");
  });
  it("riesgo conocido: el verbo 'excel' matchea la skill excel", () => {
    expect(extract("You will excel at problem solving.")).toContain("excel");
  });

  it("un texto sin nada técnico no devuelve ninguna skill nueva", () => {
    const text = "Excellent communication skills, networking events and BI-weekly syncs.";
    expect(extract(text).filter((s) => NEW_SLUGS.includes(s))).toEqual([]);
  });
});

describe("skills existentes: el resultado no cambia", () => {
  const before = taxonomy.filter((s) => !NEW_SLUGS.includes(s.slug) && !CAREER_SLUGS.has(s.slug));
  const texts = [
    "Python, FastAPI, Docker y Kubernetes sobre AWS (Lambda, S3). CI/CD con GitHub Actions.",
    "React Native y Next.js con TypeScript; testing con Playwright y Vitest.",
    "RAG con pgvector, agentes multi-step, tool calling, MCP y guardrails contra prompt injection.",
    "Fluent English, communication con stakeholders, liderazgo y mentoring.",
    "SQL Server, PostgreSQL, ETL con Spark y Kafka; analytics con Mixpanel.",
    "SEO técnico (Core Web Vitals), GA4, growth y marketing; CRM con HubSpot.",
    "Okta, OIDC, RBAC, ciberseguridad y OWASP; observabilidad con Datadog y Sentry.",
    "Accesibilidad: WCAG y a11y en componentes React.",
    "Okta, monitoring, Azure DevOps y Linux.",
  ];
  it.each(texts)("mismo resultado sobre las skills viejas: %s", (text) => {
    const withNew = extract(text).filter((s) => !NEW_SLUGS.includes(s) && !CAREER_SLUGS.has(s));
    expect(withNew).toEqual(extract(text, before));
  });
});
