import { foldText } from "../normalize/text";
import { ROLE_KEYS, type RoleKey } from "./self-assessment";

/**
 * `role_hints` del pool (ADR-014): a qué roles de ROLE_KEYS parece servir un aviso. Sin LLM: listas
 * conservadoras, como NON_IT_TITLE / IT_SIGNAL_WORDS del prefiltro (D-016). Vacío = no se sabe.
 * Dos señales, que se suman: la categoría (o tags) que da la fuente y el título.
 */

const DEV: readonly RoleKey[] = ["frontend", "backend", "fullstack"];

/**
 * Fuente → categoría → roles. Las categorías se comparan normalizadas: minúsculas, sin acentos y
 * con todo lo que no sea letra o número convertido en un guion ("Machine Learning" → "machine-learning").
 * Remote OK se consulta sobre sus `tags`; Get on Board y Jobicy sobre `categories`.
 *
 * A VERIFICAR con `pool:fetch --dry-run`: de Get on Board solo están confirmados `programming`,
 * `machine-learning-ai` y `sysadmin-devops-qa`; el resto de sus slugs y los valores de Jobicy
 * son una suposición razonable hasta mirar la respuesta real.
 */
export const SOURCE_CATEGORY_ROLES: Record<string, Record<string, readonly RoleKey[]>> = {
  getonboard_api: {
    programming: DEV,
    "mobile-developer": DEV,
    "machine-learning-ai": ["ai_engineer"],
    "data-science-analytics": ["data_analyst"],
    "design-ux": ["ux_ui"],
    "sysadmin-devops-qa": ["qa", "soporte_it"],
    // `customer-support` no está: es atención al cliente, no soporte de IT.
  },
  jobicy: {
    engineering: DEV,
    "software-engineering": DEV,
    dev: DEV,
    design: ["ux_ui"],
    "design-multimedia": ["ux_ui"],
    "data-science": ["data_analyst"],
    "data-analytics": ["data_analyst"],
    devops: ["soporte_it"],
    "dev-ops": ["soporte_it"],
    sysadmin: ["soporte_it"],
    "technical-support": ["soporte_it"],
    supporting: ["soporte_it"],
    qa: ["qa"],
    "quality-assurance": ["qa"],
  },
  remoteok: {
    dev: DEV,
    engineer: DEV,
    javascript: DEV,
    react: DEV,
    backend: DEV,
    frontend: DEV,
    fullstack: DEV,
    "full-stack": DEV,
    design: ["ux_ui"],
    ux: ["ux_ui"],
    ui: ["ux_ui"],
    qa: ["qa"],
    testing: ["qa"],
    // Ni `support` ni `customer-support`: en Remote OK son atención al cliente, no soporte de IT.
    sysadmin: ["soporte_it"],
    data: ["data_analyst"],
    analyst: ["data_analyst"],
    sql: ["data_analyst"],
    ai: ["ai_engineer"],
    "machine-learning": ["ai_engineer"],
    llm: ["ai_engineer"],
  },
};

/**
 * Palabras y frases del título, ya sin acentos ni mayúsculas. Se buscan con límite de palabra
 * ("ui" no está en "build", "ia" no está en "media"); un plural simple con "s" también cuenta.
 */
const TITLE_TERMS: Record<RoleKey, readonly string[]> = {
  frontend: [
    "frontend",
    "front end",
    "react",
    "angular",
    "vue",
    "svelte",
    "desarrollador front",
    "desarrolladora front",
  ],
  backend: [
    "backend",
    "back end",
    "java",
    "node",
    "dotnet",
    "net developer",
    "net engineer",
    "asp net",
    "python developer",
    "python engineer",
    "desarrollador python",
    "golang",
    "php developer",
    "ruby developer",
    "ruby on rails",
  ],
  fullstack: ["full stack", "fullstack"],
  qa: [
    "qa",
    "tester",
    "testing",
    "test automation",
    "automation engineer",
    "sdet",
    "quality assurance",
    "quality engineer",
    "quality analyst",
    "analista de calidad",
    "aseguramiento de calidad",
    "calidad de software",
  ],
  data_analyst: [
    "data analyst",
    "data analytics",
    "analista de datos",
    "analista de data",
    "bi",
    "business intelligence",
    "inteligencia de negocio",
    "analytics engineer",
  ],
  soporte_it: [
    // Nunca "support" ni "soporte" sueltos: "Customer Support Representative" es atención al cliente.
    "technical support",
    "it support",
    "soporte tecnico",
    "soporte it",
    "tecnico de soporte",
    "soporte informatico",
    "soporte de sistemas",
    "tecnico en sistemas",
    "help desk",
    "helpdesk",
    "mesa de ayuda",
    "service desk",
    "sysadmin",
    "system administrator",
    "administrador de sistemas",
    "tecnico it",
    "tecnico informatico",
  ],
  ai_engineer: [
    "ai engineer",
    "ai developer",
    "applied ai",
    "genai",
    "generative ai",
    "ia generativa",
    "machine learning",
    "aprendizaje automatico",
    "llm",
    "ml engineer",
    "mlops",
    "inteligencia artificial",
    "artificial intelligence",
    "ia",
  ],
  ux_ui: [
    "ux",
    "ui",
    "product designer",
    "interaction designer",
    "web designer",
    "disenador de producto",
    "disenadora de producto",
    "disenador web",
    "disenadora web",
    "disenador de interfaces",
    "disenadora de interfaces",
  ],
};

/** Títulos de desarrollo sin especialidad: sirven a frontend, backend y fullstack. */
const GENERIC_DEV_TERMS = [
  "developer",
  "desarrollador",
  "desarrolladora",
  "software engineer",
  "ingeniero de software",
  "ingeniera de software",
  "programador",
  "programadora",
];

/** "Business developer" es ventas; "developer advocate / relations" es comunidad: no son desarrollo. */
const NOT_DEV_TERMS = [
  "business developer",
  "business development",
  "sales developer",
  "advocate",
  "relations",
];

function normalizeTitleText(title: string): string {
  return ` ${foldText(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function hasTerm(padded: string, term: string): boolean {
  return padded.includes(` ${term} `) || padded.includes(` ${term}s `);
}

function normalizeCategory(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferRoleHints(input: {
  sourceKind: string;
  title: string;
  tags?: readonly string[];
  categories?: readonly string[];
}): RoleKey[] {
  const found = new Set<RoleKey>();

  // 1. Categoría (o tags) de la fuente
  const table = SOURCE_CATEGORY_ROLES[input.sourceKind];
  if (table) {
    for (const raw of [...(input.categories ?? []), ...(input.tags ?? [])]) {
      const roles = Object.hasOwn(table, normalizeCategory(raw))
        ? table[normalizeCategory(raw)]
        : undefined;
      for (const role of roles ?? []) found.add(role);
    }
  }

  // 2. Título
  const title = normalizeTitleText(input.title);
  let titleMatched = false;
  for (const role of ROLE_KEYS) {
    if (TITLE_TERMS[role].some((term) => hasTerm(title, term))) {
      found.add(role);
      titleMatched = true;
    }
  }
  // La palabra genérica solo cuenta si el título no nombra ya otra especialidad
  // ("AI Developer" es ai_engineer, no un desarrollador de los tres roles).
  if (
    !titleMatched &&
    GENERIC_DEV_TERMS.some((term) => hasTerm(title, term)) &&
    !NOT_DEV_TERMS.some((term) => hasTerm(title, term))
  ) {
    for (const role of DEV) found.add(role);
  }

  return ROLE_KEYS.filter((role) => found.has(role));
}
