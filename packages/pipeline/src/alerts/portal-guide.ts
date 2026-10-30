/**
 * Guía de alertas por portal (ronda 108, parte 1 de «Tu cobertura de portales»). Puro: no abre
 * ningún link ni consulta ningún portal (ADR-004); los links son para que la persona los abra. La
 * lectura de los mails que llegaron la hace la app y pasa la fecha del último (`portalStatus`).
 */
import { DEFAULT_ALERT_SENDERS } from "../gmail-filters";
import { baseDomain, EXPECTED_SOURCE_DOMAINS, senderHost } from "../filter-leak";
import type { RoleKey } from "../skills/self-assessment";

export type AlertPortalId = "linkedin" | "indeed" | "getonboard";

export type AlertPortal = {
  id: AlertPortalId;
  name: string;
  /** Dominios base del remitente (de `EXPECTED_SOURCE_DOMAINS`). */
  domains: readonly string[];
  /** Cómo crear la alerta, en una línea. */
  howTo: string;
};

const domainsStartingWith = (prefix: string): string[] =>
  EXPECTED_SOURCE_DOMAINS.filter((d) => d.startsWith(prefix));

export const ALERT_PORTALS: readonly AlertPortal[] = [
  {
    id: "linkedin",
    name: "LinkedIn",
    domains: domainsStartingWith("linkedin"),
    howTo:
      "En LinkedIn, buscá en Empleos con la palabra, tocá «Crear alerta de empleo» y elegí frecuencia diaria.",
  },
  {
    id: "indeed",
    name: "Indeed",
    domains: domainsStartingWith("indeed"),
    howTo:
      "En Indeed, buscá con la palabra y activá «Recibir nuevas ofertas por email» debajo del buscador.",
  },
  {
    id: "getonboard",
    name: "Get on Board",
    domains: domainsStartingWith("getonb"),
    howTo:
      "En Get on Board, entrá a tu cuenta › Alertas (o «Guardar búsqueda») y elegí las categorías o palabras.",
  },
];

/** Una carrera nueva (como las de los PR #148 y #154) todavía puede no estar en `RoleKey`. */
export type AlertRoleKey =
  RoleKey | "data_engineer" | "solutions_engineer" | "ventas_b2b" | "atencion_cliente";

type Keywords = { es: string[]; en: string[] };

/**
 * Palabras para crear las alertas, curadas a mano (3 a 6 por idioma). `Partial` a propósito: una
 * carrera nueva sin entrada no rompe el typecheck; usa su rótulo (`alertKeywordsFor`) y un test
 * avisa que falta.
 */
export const ALERT_KEYWORDS: Partial<Record<AlertRoleKey, Keywords>> = {
  frontend: {
    es: ["desarrollador frontend", "react", "javascript", "typescript", "desarrollador web"],
    en: ["frontend developer", "react", "javascript", "typescript", "web developer"],
  },
  backend: {
    es: ["desarrollador backend", "node", "java", "python", "api", "desarrollador de software"],
    en: ["backend developer", "node", "java", "python", "api developer"],
  },
  fullstack: {
    es: ["full stack", "desarrollador full stack", "javascript", "react", "node"],
    en: ["full stack developer", "fullstack engineer", "javascript", "react", "node"],
  },
  qa: {
    es: ["qa", "tester", "analista qa", "automatización de pruebas", "testing"],
    en: ["qa engineer", "tester", "test automation", "sdet", "quality assurance"],
  },
  data_analyst: {
    es: ["analista de datos", "sql", "power bi", "excel", "business intelligence"],
    en: ["data analyst", "sql", "power bi", "tableau", "business intelligence"],
  },
  soporte_it: {
    es: ["soporte técnico", "soporte it", "help desk", "mesa de ayuda", "sysadmin"],
    en: ["it support", "help desk", "service desk", "technical support", "sysadmin"],
  },
  ai_engineer: {
    es: ["inteligencia artificial", "python", "chatbot", "automatización", "desarrollador IA"],
    en: ["ai engineer", "machine learning", "python", "chatbot", "llm", "ai developer"],
  },
  ux_ui: {
    es: ["diseñador ux", "diseñador ui", "ux ui", "diseño de producto", "figma"],
    en: ["ux designer", "ui designer", "product designer", "ux researcher", "figma"],
  },
  marketing_digital: {
    es: [
      "marketing digital",
      "community manager",
      "seo",
      "brand manager",
      "relaciones públicas",
      "trade marketing",
    ],
    en: [
      "digital marketing",
      "seo",
      "content marketing",
      "brand manager",
      "public relations",
      "market research analyst",
    ],
  },
  rrhh_it: {
    es: ["reclutador it", "recursos humanos", "talent acquisition", "selección de personal"],
    en: ["technical recruiter", "it recruiter", "talent acquisition", "hr business partner"],
  },
  customer_success: {
    es: ["customer success", "atención al cliente", "soporte al cliente", "account manager"],
    en: ["customer success manager", "customer support", "account manager", "client onboarding"],
  },
  ciberseguridad: {
    es: ["ciberseguridad", "seguridad informática", "analista de seguridad", "pentesting"],
    en: ["cybersecurity", "security analyst", "pentester", "infosec", "soc analyst"],
  },
  product_manager: {
    es: ["product manager", "gerente de producto", "gestión de producto", "producto digital"],
    en: ["product manager", "product management", "technical product manager", "product lead"],
  },
  product_owner: {
    es: ["product owner", "scrum", "agile", "analista funcional"],
    en: ["product owner", "scrum", "agile", "business analyst"],
  },
  project_manager: {
    es: ["project manager", "líder de proyecto", "gestión de proyectos", "scrum master", "pmo"],
    en: ["project manager", "program manager", "scrum master", "delivery manager", "pmo"],
  },
  product_marketing: {
    es: ["product marketing", "marketing de producto", "growth", "go to market"],
    en: ["product marketing manager", "growth marketing", "go to market", "product marketing"],
  },
  data_engineer: {
    es: ["ingeniero de datos", "data engineer", "etl", "sql", "python"],
    en: ["data engineer", "etl", "sql", "python", "data pipeline"],
  },
  solutions_engineer: {
    es: ["ingeniero de soluciones", "solutions engineer", "preventa", "ingeniero de preventa"],
    en: ["solutions engineer", "sales engineer", "pre sales", "solutions architect"],
  },
  ventas_b2b: {
    es: [
      "ejecutivo comercial",
      "ventas b2b",
      "sdr",
      "desarrollo de negocios",
      "ejecutivo de cuentas",
    ],
    en: ["sales development representative", "account executive", "sdr", "business development"],
  },
  atencion_cliente: {
    es: ["atención al cliente", "servicio al cliente", "soporte al cliente", "call center"],
    en: ["customer support", "customer service", "support agent", "customer care"],
  },
  finanzas_contabilidad: {
    es: [
      "contador",
      "contabilidad",
      "analista impositivo",
      "liquidación de sueldos",
      "auditoría",
      "analista financiero",
    ],
    en: ["accountant", "bookkeeper", "tax analyst", "payroll analyst", "internal auditor", "fp&a"],
  },
  asistencia_operaciones: {
    es: [
      "asistente virtual",
      "asistente administrativo",
      "asistente ejecutiva",
      "coordinador de operaciones",
      "carga de datos",
    ],
    en: [
      "virtual assistant",
      "executive assistant",
      "administrative assistant",
      "operations coordinator",
      "data entry",
    ],
  },
  // C1-5 (ADR-027): las carreras de la beta. Cada palabra es un término de título de la carrera.
  abogacia: {
    es: [
      "abogado",
      "asesor legal",
      "analista legal",
      "paralegal",
      "oficial de cumplimiento",
      "analista de contratos",
    ],
    en: [
      "legal counsel",
      "paralegal",
      "legal analyst",
      "compliance officer",
      "corporate counsel",
      "contracts counsel",
    ],
  },
  administracion_empresas: {
    es: [
      "analista administrativo",
      "analista de compras",
      "analista de control de gestión",
      "analista comercial",
      "analista de procesos",
      "comprador",
    ],
    en: [
      "procurement analyst",
      "supply chain analyst",
      "pricing analyst",
      "management consultant",
      "buyer",
      "demand planner",
    ],
  },
  comunicacion: {
    es: [
      "analista de comunicación",
      "comunicación institucional",
      "comunicación interna",
      "periodista",
      "jefe de prensa",
      "redactor",
    ],
    en: [
      "communications specialist",
      "internal communications",
      "journalist",
      "press officer",
      "content writer",
      "media relations",
    ],
  },
  relaciones_internacionales: {
    es: [
      "analista de comercio exterior",
      "comercio exterior",
      "cooperación internacional",
      "relaciones institucionales",
      "analista de importaciones",
      "oficial de programas",
    ],
    en: [
      "foreign trade",
      "program officer",
      "government affairs",
      "public policy analyst",
      "import export specialist",
      "grants officer",
    ],
  },
};

/** Para quien todavía no eligió carrera. */
export const GENERIC_ALERT_KEYWORDS: Keywords = {
  es: ["desarrollador", "programador", "analista de sistemas", "soporte it", "remoto"],
  en: ["software developer", "software engineer", "it support", "remote developer"],
};

export type AlertLanguage = "es" | "en" | "both";

/**
 * Palabras sugeridas para las carreras y el idioma de la persona, sin repetir y en orden. Una
 * carrera sin entrada usa su rótulo; sin carreras, las genéricas.
 */
export function alertKeywordsFor(roles: readonly string[], language: AlertLanguage): string[] {
  const langs: ("es" | "en")[] = language === "both" ? ["es", "en"] : [language];
  const table = ALERT_KEYWORDS as Partial<Record<string, Keywords>>;
  const out: string[] = [];
  const add = (word: string) => {
    if (!out.includes(word)) out.push(word);
  };
  if (roles.length === 0) {
    for (const lang of langs) GENERIC_ALERT_KEYWORDS[lang].forEach(add);
    return out;
  }
  for (const role of roles) {
    const entry = Object.hasOwn(table, role) ? table[role] : undefined;
    if (!entry) {
      add(role.replace(/_/g, " "));
      continue;
    }
    for (const lang of langs) entry[lang].forEach(add);
  }
  return out;
}

const MAX_URL_KEYWORDS = 6;

/**
 * Link de búsqueda pública que abre la persona; `null` si el portal no tiene una URL estable y sin
 * sesión. Indeed: el dominio depende del país (ar.indeed.com, www.indeed.com…) y no lo sabemos con
 * certeza. Get on Board: no tiene una URL de búsqueda por palabra estable.
 */
export function searchUrlFor(portal: AlertPortalId, keywords: readonly string[]): string | null {
  const words = keywords.slice(0, MAX_URL_KEYWORDS).filter((w) => w.trim() !== "");
  if (words.length === 0) return null;
  if (portal === "linkedin") {
    const q = words.map((w) => (/\s/.test(w) ? `"${w}"` : w)).join(" OR ");
    const params = new URLSearchParams({ keywords: q });
    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  }
  return null;
}

export type PortalStatus = "activo" | "sin_novedad" | "nunca";

export const PORTAL_ACTIVE_DAYS = 14;

/** «activo»: último mail hace 14 días o menos; «sin_novedad»: hubo, pero más viejos; «nunca». */
export function portalStatus(lastReceivedAt: Date | null, now: Date): PortalStatus {
  if (!lastReceivedAt) return "nunca";
  const days = (now.getTime() - lastReceivedAt.getTime()) / (24 * 60 * 60 * 1000);
  return days <= PORTAL_ACTIVE_DAYS ? "activo" : "sin_novedad";
}

function addressOf(fromAddress: string): string {
  return (/<([^>]+)>/.exec(fromAddress)?.[1] ?? fromAddress).trim().toLowerCase();
}

/**
 * Portal de un remitente, o `null`. LinkedIn cuenta solo con los remitentes de empleo
 * (`DEFAULT_ALERT_SENDERS` con dirección completa), no con los sociales.
 */
export function portalOfSender(fromAddress: string): AlertPortalId | null {
  const host = senderHost(fromAddress);
  if (!host) return null;
  const addr = addressOf(fromAddress);
  const exact = DEFAULT_ALERT_SENDERS.filter((s) => s.includes("@"));
  if (exact.includes(addr)) {
    const domain = baseDomain(host);
    return ALERT_PORTALS.find((p) => p.domains.includes(domain))?.id ?? null;
  }
  const domain = baseDomain(host);
  const portal = ALERT_PORTALS.find((p) => p.id !== "linkedin" && p.domains.includes(domain));
  return portal?.id ?? null;
}
