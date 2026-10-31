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
 * `customer-support` (ronda 107, ADR-022): atención al cliente y customer success comparten la
 * categoría; `titleFit` los separa con los vetos cruzados. No es soporte de IT.
 */
const CUSTOMER_SUPPORT: readonly RoleKey[] = ["atencion_cliente", "customer_success"];

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
    "customer-support": CUSTOMER_SUPPORT,
    // Ronda 107 (ADR-022): ventas B2B. La categoría trae también ventas de mostrador y comercio:
    // los términos de título y sus vetos separan.
    sales: ["ventas_b2b"],
    // Ronda 103 (ADR-020). Operaciones trae también gerencia y administración: `titleFit` deja
    // solo los títulos de proyectos. Publicidad y medios es lo más cercano a marketing digital.
    "operations-management": ["project_manager"],
    "advertising-media": ["marketing_digital"],
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
    "customer-support": CUSTOMER_SUPPORT,
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
    // `support` suelto no se mapea; `customer-support` es atención al cliente, no soporte de IT.
    "customer-support": CUSTOMER_SUPPORT,
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
    "remote-customer-support-jobs": CUSTOMER_SUPPORT,
    "customer-support": CUSTOMER_SUPPORT,
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
    // Ronda 106 (ADR-021): lenguajes y especialidades de backend seguidos de "engineer".
    "rust engineer",
    "elixir engineer",
    "scala engineer",
    "kotlin engineer",
    "golang engineer",
    "postgres engineer",
    "postgresql engineer",
    "microservices engineer",
    "distributed systems engineer",
    "software architect",
  ],
  // "Product engineer" también es fullstack, pero se resuelve aparte (PRODUCT_ENGINEER_*).
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
    // "Analytics engineer" pasó a data_engineer (ronda 106).
    "data scientist",
    "product analyst",
  ],
  soporte_it: [
    // Nunca "support" ni "soporte" sueltos: "Customer Support Representative" es atención al cliente.
    // "Support engineer" suelto tampoco: es soporte de producto. Solo con technical, software,
    // database o application delante (los de abajo; "technical support" ya cubre el primero).
    "software support engineer",
    "database support engineer",
    "application support engineer",
    "site reliability",
    "sre",
    "devops",
    "gitops",
    "platform engineer",
    "infrastructure engineer",
    "infra engineer",
    "it engineer",
    "it systems",
    "it operations",
    "desktop support",
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
    "research engineer",
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
    // T2: "product designer" ya estaba; se suma la disciplina (exclusiones: hardware y mecánica).
    "product design",
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
    // Ronda 107 (ADR-022): contenido, redes, gráfico y video son subespecialidades de la carrera.
    // Nada de "designer" ni "content" sueltos: "designer" es ux_ui.
    "copywriter",
    "content creator",
    "content writer",
    "content producer",
    "content specialist",
    "redactor",
    "redactora",
    "graphic designer",
    "disenador grafico",
    "disenadora grafica",
    "video editor",
    "editor de video",
    "editora de video",
    "motion graphics",
    "motion designer",
    "creador de contenido",
    "creadora de contenido",
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
    // Ronda 107 (ADR-022): RRHH general, no solo IT.
    "hr",
    "hr generalist",
    "hr manager",
    "hr specialist",
    "hr coordinator",
    "people operations",
    "people ops",
    "talent partner",
    "recruiting",
    "recruitment",
    "reclutamiento",
  ],
  customer_success: [
    // Nunca "customer support" ni "atencion al cliente": es atención, no customer success.
    "customer success",
    "client success",
    "customer onboarding",
    "technical account manager",
    // T2: "key account manager" es ventas (ver la exclusión).
    "account manager",
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
    "security operations",
    "security architect",
    "security researcher",
    "security infrastructure",
    "security governance",
    "security risk engineer",
    "threat intelligence",
    "red team",
    "incident response",
    // Lista cerrada: "cyber" por prefijo traía "Cyber Monday Marketing Manager".
    "cyber security",
    "cyberdefense",
    "cyber defense",
    "cyberops",
    "cyber ops",
    "cyber threat",
    "cyber risk",
    "cyber analyst",
    "cyber engineer",
  ],
  data_engineer: [
    "data engineer",
    "analytics engineer",
    "etl",
    "data platform engineer",
    "ingeniero de datos",
    "ingeniera de datos",
    "big data engineer",
  ],
  solutions_engineer: [
    "solutions engineer",
    "solution engineer",
    "solutions architect",
    "solution architect",
    "sales engineer",
    "pre sales",
    "presales",
    "forward deployed engineer",
    // "Field engineer" suelto es de campo (hardware, telecom): solo con software, solutions o customer.
    "software field engineer",
    "solutions field engineer",
    "customer field engineer",
    "professional services engineer",
    "professional services consultant",
    "ingeniero de preventa",
    "ingeniera de preventa",
    // T2
    "solutions engineering",
    "implementation consultant",
    "implementation engineer",
    "technical architect",
    "solutions consultant",
    "deployment engineer",
    "deployment strategist",
  ],
  // Ronda 107 (ADR-022). "Account manager" suelto NO va: es de customer_success (status quo).
  ventas_b2b: [
    "sdr",
    "bdr",
    "sales development",
    "business development",
    "business development representative",
    "account executive",
    "inside sales",
    "sales representative",
    "sales executive",
    "sales manager",
    "sales lead",
    "key account",
    "partner manager",
    "ejecutivo comercial",
    "ejecutiva comercial",
    "ejecutivo de cuentas",
    "ejecutiva de cuentas",
    "ejecutivo de ventas",
    "ejecutiva de ventas",
    "representante de ventas",
    "asesor comercial",
    "asesora comercial",
    "desarrollo de negocios",
    "vendedor",
    "vendedora",
    "vendedores",
    "vendedoras",
    "ventas b2b",
    // T2
    "sales director",
    "regional sales",
    "enterprise sales",
    "head of sales",
  ],
  atencion_cliente: [
    "customer support",
    "customer service",
    "customer care",
    "support agent",
    "support representative",
    "support specialist",
    "support associate",
    "atencion al cliente",
    "atencion al usuario",
    "servicio al cliente",
    "call center",
    "contact center",
    "contact centre",
    "agente de soporte",
    "agente de atencion",
    "representante de atencion",
    "representante de servicio",
  ],
  // C-2b (ADR-023). Nunca "finance", "controller", "revenue" ni "finops" sueltos.
  finanzas_contabilidad: [
    "accountant",
    "accounting",
    "bookkeeper",
    "bookkeeping",
    "accounts payable",
    "accounts receivable",
    "ap specialist",
    "ar specialist",
    "ap clerk",
    "ap ar",
    "billing specialist",
    "billing analyst",
    "payroll",
    "financial analyst",
    "finance analyst",
    "fp a",
    "financial planning",
    "finance associate",
    "finance specialist",
    "finance coordinator",
    "finance assistant",
    "finance operations",
    "financial operations",
    "financial controller",
    "assistant controller",
    "treasury",
    "tax analyst",
    "tax associate",
    "tax specialist",
    "auditor",
    "internal audit",
    "contador",
    "contadora",
    "contable",
    "contabilidad",
    "analista financiero",
    "analista financiera",
    "analista de finanzas",
    "finanzas",
    "tesoreria",
    "cuentas por pagar",
    "cuentas por cobrar",
    "facturacion",
    "nomina",
    "liquidacion de sueldos",
    "impuestos",
    "impositivo",
    "impositiva",
    "auditora",
    "control de gestion",
  ],
  // Nunca "operations" ni "assistant" sueltos.
  asistencia_operaciones: [
    "virtual assistant",
    "executive assistant",
    "administrative assistant",
    "admin assistant",
    "personal assistant",
    "office manager",
    "office administrator",
    "office coordinator",
    "administrative coordinator",
    "operations coordinator",
    "operations specialist",
    "operations associate",
    "operations assistant",
    "operations analyst",
    "business operations",
    "bizops",
    "data entry",
    "back office",
    "backoffice",
    "asistente virtual",
    "asistente ejecutivo",
    "asistente ejecutiva",
    "asistente administrativo",
    "asistente administrativa",
    "asistente personal",
    "asistente de direccion",
    "asistente de gerencia",
    "auxiliar administrativo",
    "auxiliar administrativa",
    "administrativo",
    "administrativa",
    "coordinador de operaciones",
    "coordinadora de operaciones",
    "analista de operaciones",
    "asistente de operaciones",
    "especialista en operaciones",
    "carga de datos",
    "ingreso de datos",
    "secretaria ejecutiva",
  ],
  // C1-2 (ADR-027): las carreras de la beta nacen sin términos de título; los suma C1-3 junto con
  // sus exclusiones y vetos.
  abogacia: [],
  administracion_empresas: [],
  comunicacion: [],
  relaciones_internacionales: [],
};

/** Palabras que anulan el puesto aunque el título tenga uno de sus términos. */
export const TITLE_EXCLUSIONS: Partial<Record<RoleKey, readonly string[]>> = {
  ciberseguridad: ["physical security", "data center security"],
  // Esas infraestructuras y plataformas son de seguridad y de datos, ya tienen su carrera.
  soporte_it: ["security infrastructure", "data platform", "data infrastructure"],
  // T2: hardware y mecánica no son diseño de producto digital.
  ux_ui: ["mechanical", "hardware"],
  // T2: «Key Account Manager» es ventas; «account manager» a secas es customer success.
  customer_success: ["key account manager", "key accounts manager"],
  // Ronda 107 (ADR-022): «Sales Engineer» es solutions_engineer y «Business Developer» no es ventas.
  ventas_b2b: [
    "engineering",
    "engineer",
    "architect",
    "developer",
    "ingeniero",
    "ingeniera",
    "presales",
    "pre sales",
    "preventa",
  ],
  // «IT Support», «Technical Support Specialist», «Customer Support Engineer», «Agente de soporte técnico».
  atencion_cliente: [
    "technical",
    "it",
    "engineer",
    "software",
    "developer",
    "success",
    "tecnico",
    "tecnica",
    "data",
  ],
  // C-2b (ADR-023). No va «sales»: «Sales Tax Analyst» es finanzas.
  finanzas_contabilidad: [
    "engineer",
    "developer",
    "desarrollador",
    "desarrolladora",
    "ingeniero",
    "ingeniera",
    "software",
    "quant",
    "quantitative",
    "it",
    "security",
    "seguridad",
    "sistemas",
    "medical",
    "dental",
    "clinical",
  ],
  // Operaciones de otra función (ventas, IT, producto...) y títulos técnicos o de campo.
  asistencia_operaciones: [
    "sales operations",
    "sales ops",
    "revenue operations",
    "revops",
    "marketing operations",
    "marketing ops",
    "security operations",
    "it operations",
    "network operations",
    "cloud operations",
    "platform operations",
    "data operations",
    "people operations",
    "people ops",
    "hr operations",
    "product operations",
    "product ops",
    "finance operations",
    "financial operations",
    "accounting operations",
    "fraud",
    "trust and safety",
    "trust safety",
    "engineer",
    "developer",
    "devops",
    "clinical",
    "medical",
    "warehouse",
    "manufacturing",
    "field operations",
    "operaciones comerciales",
    "operaciones de ventas",
    "operaciones de marketing",
    "desarrollador",
    "desarrolladora",
    "ingeniero",
    "ingeniera",
  ],
};

/**
 * "Product engineer" es fullstack, salvo en manufactura, hardware o mecánica. La exclusión aplica
 * solo a este término: "Full Stack Engineer, Hardware Platform" sigue siendo fullstack.
 */
const PRODUCT_ENGINEER = "product engineer";
const PRODUCT_ENGINEER_EXCLUSIONS = ["manufacturing", "hardware", "mechanical"];

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

/**
 * ¿El título (ya normalizado) nombra el puesto? Usa los términos de `TITLE_TERMS` (y «product engineer» para fullstack),
 * salvo que tenga una palabra de `TITLE_EXCLUSIONS`. `extraTerms` suma frases fuertes de otros
 * módulos (`titleFit`). Con "AI + rol técnico" ("ML Infrastructure Engineer", "AI Platform
 * Engineer") soporte_it no aplica: ahí la infraestructura es de IA, no de IT interno.
 */
export function matchesRoleTitle(
  padded: string,
  role: RoleKey,
  extraTerms: readonly string[] = [],
): boolean {
  if ((TITLE_EXCLUSIONS[role] ?? []).some((w) => hasTerm(padded, w))) return false;
  if (role === "soporte_it" && matchesAiWithTechRole(padded)) return false;
  if ([...TITLE_TERMS[role], ...extraTerms].some((term) => hasTerm(padded, term))) return true;
  return (
    role === "fullstack" &&
    hasTerm(padded, PRODUCT_ENGINEER) &&
    !PRODUCT_ENGINEER_EXCLUSIONS.some((w) => hasTerm(padded, w))
  );
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
    if (matchesRoleTitle(title, role)) fromTitle.add(role);
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
