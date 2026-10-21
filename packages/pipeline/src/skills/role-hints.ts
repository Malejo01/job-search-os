import { foldText } from "../normalize/text";
import { ROLE_KEYS, type RoleKey } from "./self-assessment";

/**
 * `role_hints` del pool (ADR-014): a qué roles de ROLE_KEYS parece servir un aviso. Sin LLM: listas
 * conservadoras, como NON_IT_TITLE / IT_SIGNAL_WORDS del prefiltro (D-016). Vacío = no se sabe.
 * Dos señales, que se suman: la categoría (o tags) que da la fuente y el título.
 */

const DEV: readonly RoleKey[] = ["frontend", "backend", "fullstack"];

/**
 * Categorías de producto: la fuente no distingue las carreras, así que dan todas las que pueden
 * ser (`titleFit` separa después por título). `product_marketing` no sale de ninguna categoría.
 */
const PRODUCT_ONLY: readonly RoleKey[] = ["product_manager", "product_owner"];
const PRODUCT_PROJECT: readonly RoleKey[] = [...PRODUCT_ONLY, "project_manager"];

/**
 * Fuente → categoría → roles. Las categorías se comparan normalizadas: minúsculas, sin acentos y
 * con todo lo que no sea letra o número convertido en un guion ("Machine Learning" → "machine-learning").
 * Remote OK se consulta sobre sus `tags`; Get on Board y Jobicy sobre `categories`.
 *
 * A VERIFICAR con `pool:fetch --dry-run`: de Get on Board solo están confirmados `programming`,
 * `machine-learning-ai` y `sysadmin-devops-qa`; el resto de sus slugs y los valores de Jobicy
 * y Remote OK son una suposición razonable hasta mirar la respuesta real. El `--dry-run` ahora
 * lista las categorías (Jobicy) y tags (Remote OK) reales con su conteo. `support` suelto no
 * se mapea en ninguna fuente.
 */
export const SOURCE_CATEGORY_ROLES: Record<string, Record<string, readonly RoleKey[]>> = {
  getonboard_api: {
    programming: DEV,
    "mobile-developer": DEV,
    "machine-learning-ai": ["ai_engineer"],
    "data-science-analytics": ["data_analyst"],
    "design-ux": ["ux_ui"],
    "sysadmin-devops-qa": ["qa", "soporte_it"],
    "digital-marketing": ["marketing_digital"],
    hr: ["rrhh_it"],
    "innovation-agile": PRODUCT_PROJECT,
    "technical-support": ["soporte_it"],
    cybersecurity: ["ciberseguridad"],
    // `customer-support` es atención al cliente: no es soporte de IT, sí customer success.
    "customer-support": ["customer_success"],
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
    marketing: ["marketing_digital"],
    seo: ["marketing_digital"],
    "social-media": ["marketing_digital"],
    hr: ["rrhh_it"],
    "human-resources": ["rrhh_it"],
    recruiting: ["rrhh_it"],
    product: PRODUCT_ONLY,
    "project-management": ["project_manager"],
    "customer-success": ["customer_success"],
    security: ["ciberseguridad"],
    cybersecurity: ["ciberseguridad"],
    programming: DEV,
    "software-development": DEV,
    "web-development": DEV,
    "web-app-design": ["ux_ui"],
    "data-science-analytics": ["data_analyst"],
    "devops-infrastructure": ["soporte_it"],
    "hr-recruiting": ["rrhh_it"],
    "machine-learning": ["ai_engineer"],
    "artificial-intelligence": ["ai_engineer"],
    "ai-ml": ["ai_engineer"],
    ai: ["ai_engineer"],
    // `customer-support` no entra: es atención al cliente, no soporte de IT.
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
    marketing: ["marketing_digital"],
    seo: ["marketing_digital"],
    "digital-marketing": ["marketing_digital"],
    "content-marketing": ["marketing_digital"],
    hr: ["rrhh_it"],
    recruiter: ["rrhh_it"],
    recruiting: ["rrhh_it"],
    product: PRODUCT_ONLY,
    "product-manager": ["product_manager"],
    "project-manager": ["project_manager"],
    "customer-success": ["customer_success"],
    security: ["ciberseguridad"],
    cybersecurity: ["ciberseguridad"],
    infosec: ["ciberseguridad"],
  },
  // We Work Remotely: el mapper deja el slug del feed en `categories` y el `<category>` del item en
  // `tags`. A VERIFICAR con `pool:fetch wwr --dry-run`: los nombres de `<category>` son una suposición.
  wwr: {
    "remote-programming-jobs": DEV,
    programming: DEV,
    "remote-full-stack-programming-jobs": ["fullstack"],
    "full-stack-programming": ["fullstack"],
    "remote-back-end-programming-jobs": ["backend"],
    "back-end-programming": ["backend"],
    "remote-front-end-programming-jobs": ["frontend"],
    "front-end-programming": ["frontend"],
    "remote-devops-sysadmin-jobs": ["soporte_it"],
    "devops-and-sysadmin": ["soporte_it"],
    "devops-sysadmin": ["soporte_it"],
    "remote-product-jobs": PRODUCT_PROJECT,
    product: PRODUCT_PROJECT,
    "remote-customer-support-jobs": ["customer_success"],
    "customer-support": ["customer_success"],
    "remote-design-jobs": ["ux_ui"],
    design: ["ux_ui"],
  },
};

/**
 * Palabras y frases del título, ya sin acentos ni mayúsculas. Se buscan con límite de palabra
 * ("ui" no está en "build", "ia" no está en "media"); un plural simple con "s" también cuenta.
 */
export const TITLE_TERMS: Record<RoleKey, readonly string[]> = {
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
    "gen ai",
    "ml ops",
    "ai ml",
    "ml ai",
    "nlp",
    "natural language processing",
    "deep learning",
    "computer vision",
    "machine learning engineer",
    "applied scientist",
    "research scientist",
    "prompt engineer",
    "ai agent",
    "ai agents",
    "agentic",
    "llmops",
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
  marketing_digital: [
    "marketing digital",
    "digital marketing",
    "seo",
    "sem",
    "performance marketing",
    "growth marketing",
    "paid media",
    "media buyer",
    "trafficker",
    "community manager",
    "social media",
    "content marketing",
    "email marketing",
  ],
  product_manager: [
    "product manager",
    "product management",
    "product operations",
    "product ops",
    "gerente de producto",
    "jefe de producto",
    "jefa de producto",
    "responsable de producto",
  ],
  product_owner: ["product owner", "dueno de producto", "duena de producto"],
  project_manager: [
    "project manager",
    "program manager",
    "delivery manager",
    "scrum master",
    "agile coach",
    "pmo",
    "project coordinator",
    "gerente de proyectos",
    "jefe de proyectos",
    "jefa de proyectos",
    "lider de proyectos",
    "coordinador de proyectos",
    "coordinadora de proyectos",
    "gestor de proyectos",
    "gestora de proyectos",
  ],
  product_marketing: ["product marketing", "go to market", "gtm manager", "marketing de producto"],
  rrhh_it: [
    "recruiter",
    "tech recruiter",
    "it recruiter",
    "technical recruiter",
    "talent acquisition",
    "sourcer",
    "reclutador",
    "reclutadora",
    "analista de seleccion",
    "hr business partner",
    "hrbp",
    "people partner",
    "employer branding",
    "recursos humanos",
    "rrhh",
    "human resources",
  ],
  customer_success: [
    // Nunca "customer support" ni "atencion al cliente": es atención, no customer success.
    "customer success",
    "client success",
    "customer onboarding",
    "technical account manager",
  ],
  ciberseguridad: [
    // Nunca "security" suelto: "Security guard", "Social Security" no son del puesto.
    "ciberseguridad",
    "cybersecurity",
    "security engineer",
    "security analyst",
    "analista de seguridad",
    "seguridad informatica",
    "seguridad de la informacion",
    "infosec",
    "soc analyst",
    "pentester",
    "penetration tester",
    "ethical hacker",
    "appsec",
    "devsecops",
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

/** Palabras de rol técnico que, junto a "ai" o "ml", indican ingeniería de IA. */
const AI_TECH_ROLE_WORDS = ["engineer", "developer", "architect", "scientist", "researcher"];

/** Si el título tiene alguna, el patrón "AI + rol técnico" no aplica (los términos explícitos sí). */
export const AI_PATTERN_EXCLUDED_WORDS = [
  "sales",
  "marketing",
  "support",
  "customer",
  "account",
  "ux",
  "ui",
  "recruiter",
  "recruiting",
  "content",
  "writer",
  "trainer",
  "tutor",
  "annotator",
];

/**
 * Patrón "AI" + palabras + rol técnico: el título tiene "ai" o "ml" como palabra suelta y además
 * una palabra de rol técnico ("AI Software Engineer", "ML Infrastructure Engineer", "AI Solutions
 * Architect"). "specialist" no cuenta ("AI Sales Specialist" no es ingeniería) y las palabras de
 * AI_PATTERN_EXCLUDED_WORDS (sales, support, ux...) anulan el patrón. "AI Trainer" o "AI Data
 * Annotator" no llevan rol técnico; "HTML Developer" no entra porque "html" es otra palabra.
 * Falso positivo aceptado: "Sales Engineer AI platform" ya no entra por "sales"; otros similares
 * pueden colarse (la pista solo ordena la asignación; decide el evaluador).
 * Recibe el título ya pasado por `normalizeTitleText`.
 */
export function matchesAiWithTechRole(padded: string): boolean {
  return (
    (hasTerm(padded, "ai") || hasTerm(padded, "ml")) &&
    AI_TECH_ROLE_WORDS.some((word) => hasTerm(padded, word)) &&
    !AI_PATTERN_EXCLUDED_WORDS.some((word) => hasTerm(padded, word))
  );
}

export function normalizeTitleText(title: string): string {
  return ` ${foldText(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

export function hasTerm(padded: string, term: string): boolean {
  return padded.includes(` ${term} `) || padded.includes(` ${term}s `);
}

function normalizeCategory(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Más roles que esto en un mismo aviso se cuenta como "sin señal". */
export const MAX_ROLE_HINTS = 4;

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
  const fromTitle = new Set<RoleKey>();
  for (const role of ROLE_KEYS) {
    if (TITLE_TERMS[role].some((term) => hasTerm(title, term))) fromTitle.add(role);
  }
  if (matchesAiWithTechRole(title)) fromTitle.add("ai_engineer");
  // La palabra genérica solo cuenta si el título no nombra ya otra especialidad
  // ("AI Developer" es ai_engineer, no un desarrollador de los tres roles).
  if (
    fromTitle.size === 0 &&
    GENERIC_DEV_TERMS.some((term) => hasTerm(title, term)) &&
    !NOT_DEV_TERMS.some((term) => hasTerm(title, term))
  ) {
    for (const role of DEV) fromTitle.add(role);
  }
  for (const role of fromTitle) found.add(role);

  const roles = ROLE_KEYS.filter((role) => found.has(role));
  if (roles.length <= MAX_ROLE_HINTS) return roles;
  // Pasarse de MAX_ROLE_HINTS es "sin señal"... salvo que el título solo ya dé entre 1 y MAX:
  // el título es la señal fuerte y la categoría no la borra.
  return fromTitle.size >= 1 && fromTitle.size <= MAX_ROLE_HINTS
    ? ROLE_KEYS.filter((role) => fromTitle.has(role))
    : [];
}
