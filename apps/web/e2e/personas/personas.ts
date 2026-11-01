import type { SeedPublicJob } from "../helpers";

/**
 * Personas sintéticas de la ronda 42. Todo inventado: nombres, emails (`@personas.test`), perfiles
 * y avisos (`Empresa Ficticia`). Ninguna se parece al perfil real del dueño del producto. Cada una
 * tiene 3 ofertas de su puesto y 1 de otro puesto (control negativo: no tiene que aparecer).
 * Para sumar una persona, ver docs/panel/personas-e2e.md.
 */
export type PersonaKey =
  | "lucia"
  | "valentina"
  | "martin"
  | "tomas"
  | "mariana"
  | "camila"
  | "agustina"
  | "bruno"
  | "rocio"
  | "ines";

export type PersonaOffer = SeedPublicJob & {
  /** Es del puesto de la persona (false = control negativo, de otro puesto). */
  own: boolean;
};

export type Persona = {
  key: PersonaKey;
  name: string;
  email: string;
  password: string;
  /** Clave del puesto (`ROLE_KEYS`); la etiqueta se lee del seed `role_skills.json`. */
  role: string;
  /** Grupo del selector del paso 1 (`legend` de su `fieldset`). */
  roleGroup:
    | "Tecnología"
    | "Carreras digitales"
    | "Comunicación y relaciones"
    | "Derecho, contabilidad y gestión";
  country: string;
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  years: string;
  remoteOnly: boolean;
  summary: string;
  /** Niveles autodeclarados (1 a 3) de skills del puesto. */
  skills: { slug: string; level: 1 | 2 | 3 }[];
  offers: PersonaOffer[];
};

/** Nombre en pantalla de las skills que usan las personas (seed `skills.json`). */
export const SKILL_NAMES: Record<string, string> = {
  sql: "SQL / PostgreSQL",
  excel: "Excel",
  power_bi: "Power BI",
  statistics: "Estadística",
  analytics: "Product analytics",
  seo: "SEO técnico",
  google_ads: "Google Ads (SEM)",
  social_media: "Redes sociales (social media)",
  email_marketing: "Email marketing",
  sourcing: "Sourcing de talento",
  ats: "ATS (seguimiento de candidatos)",
  nodejs: "Node.js",
  rest_apis: "REST APIs",
  docker: "Docker",
  testing: "Testing automatizado",
  contract_drafting: "Redacción y revisión de contratos",
  corporate_law: "Derecho societario y comercial",
  labor_law: "Derecho laboral",
  litigation: "Litigio y procesos judiciales",
  legal_tools: "Software legal (Lex Doctor, CLM)",
  press_relations: "Relaciones con la prensa",
  corporate_communications: "Comunicación institucional e interna",
  copywriting: "Copywriting",
  audiovisual: "Producción audiovisual y radio",
  general_accounting: "Contabilidad y conciliaciones",
  tax_compliance: "Impuestos, auditoría y controles",
  erp_accounting: "Software contable (NetSuite, QuickBooks, Xero)",
  financial_reporting: "Reporting financiero y FP&A",
  procurement: "Compras y abastecimiento",
  process_improvement: "Procesos y mejora continua",
  management_control: "Control de gestión y tableros",
  business_strategy: "Estrategia y planificación de negocio",
  canva: "Canva",
  foreign_trade: "Comercio exterior y aduanas",
  international_cooperation: "Cooperación internacional",
  grant_writing: "Formulación de proyectos y grants",
  public_affairs: "Asuntos públicos e institucionales",
  diplomacy: "Diplomacia y negociación internacional",
  trade_agreements: "Integración y acuerdos comerciales",
};

type RawOffer = {
  skills: [string, boolean][];
  sourceKind: SeedPublicJob["sourceKind"];
};

function offers(
  tag: number,
  short: string,
  role: string,
  own: RawOffer[],
  controlRole: string,
  control: RawOffer,
): PersonaOffer[] {
  const make = (raw: RawOffer, n: number, roleKey: string, isOwn: boolean): PersonaOffer => ({
    title: `Oferta Ficticia ${short} ${n} ${tag}`,
    company: `Empresa Ficticia ${n}`,
    sourceKind: raw.sourceKind,
    roleHints: [roleKey],
    skills: raw.skills.map(([slug, isMust]) => ({ slug, isMust })),
    own: isOwn,
  });
  return [
    ...own.map((raw, i) => make(raw, i + 1, role, true)),
    make(control, own.length + 1, controlRole, false),
  ];
}

export function buildPersona(key: PersonaKey, tag: number = Date.now()): Persona {
  const base = {
    key,
    email: `${key}-${tag}@personas.test`,
    password: `personas-clave-local-${key}`,
  };
  switch (key) {
    case "lucia":
      return {
        ...base,
        name: "Lucía Ficticia",
        role: "data_analyst",
        roleGroup: "Tecnología",
        country: "AR",
        cefr: "B1",
        years: "3",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Lucía: contadora que pasa a datos, con Excel avanzado y SQL básico, busca su primer puesto de análisis.",
        skills: [
          { slug: "excel", level: 3 },
          { slug: "sql", level: 1 },
          { slug: "power_bi", level: 2 },
          { slug: "statistics", level: 1 },
        ],
        offers: offers(
          tag,
          "Datos",
          "data_analyst",
          [
            {
              sourceKind: "getonboard_api",
              skills: [
                ["sql", true],
                ["excel", true],
                ["power_bi", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["sql", true],
                ["statistics", true],
                ["analytics", false],
              ],
            },
            {
              sourceKind: "jobicy",
              skills: [
                ["excel", true],
                ["power_bi", true],
                ["sql", false],
              ],
            },
          ],
          "marketing_digital",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["seo", true],
              ["google_ads", true],
            ],
          },
        ),
      };
    case "valentina":
      return {
        ...base,
        name: "Valentina Ficticia",
        role: "marketing_digital",
        roleGroup: "Comunicación y relaciones",
        country: "MX",
        cefr: "B2",
        years: "5",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Valentina: especialista en SEO, campañas pagas y redes sociales para tiendas online de la región.",
        skills: [
          { slug: "seo", level: 3 },
          { slug: "google_ads", level: 2 },
          { slug: "social_media", level: 3 },
          { slug: "email_marketing", level: 1 },
        ],
        offers: offers(
          tag,
          "Marketing",
          "marketing_digital",
          [
            {
              sourceKind: "getonboard_api",
              skills: [
                ["seo", true],
                ["google_ads", true],
                ["analytics", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["social_media", true],
                ["email_marketing", true],
                ["excel", false],
              ],
            },
            {
              sourceKind: "jobicy",
              skills: [
                ["seo", true],
                ["social_media", false],
              ],
            },
          ],
          "backend",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["nodejs", true],
              ["docker", true],
            ],
          },
        ),
      };
    case "martin":
      return {
        ...base,
        name: "Martín Ficticio",
        role: "rrhh_it",
        roleGroup: "Carreras digitales",
        country: "CL",
        cefr: "C1",
        years: "8",
        remoteOnly: false,
        summary:
          "Perfil ficticio de la persona Martín: viene de recursos humanos generales y quiere pasar a reclutar perfiles de tecnología.",
        skills: [
          { slug: "sourcing", level: 2 },
          { slug: "ats", level: 3 },
          { slug: "excel", level: 2 },
        ],
        offers: offers(
          tag,
          "Recruiting",
          "rrhh_it",
          [
            {
              sourceKind: "getonboard_api",
              skills: [
                ["sourcing", true],
                ["ats", true],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["sourcing", true],
                ["excel", false],
              ],
            },
            {
              sourceKind: "jobicy",
              skills: [
                ["ats", true],
                ["excel", true],
              ],
            },
          ],
          "data_analyst",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["sql", true],
              ["power_bi", true],
            ],
          },
        ),
      };
    case "tomas":
      return {
        ...base,
        name: "Tomás Ficticio",
        role: "backend",
        roleGroup: "Tecnología",
        country: "CO",
        cefr: "B1",
        years: "1.5",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Tomás: desarrollador junior con Node.js, bases SQL y pruebas, busca su segundo puesto en backend.",
        skills: [
          { slug: "nodejs", level: 2 },
          { slug: "sql", level: 2 },
          { slug: "rest_apis", level: 3 },
          { slug: "docker", level: 1 },
        ],
        offers: offers(
          tag,
          "Backend",
          "backend",
          [
            {
              sourceKind: "getonboard_api",
              skills: [
                ["nodejs", true],
                ["sql", true],
                ["rest_apis", true],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["nodejs", true],
                ["docker", true],
                ["testing", false],
              ],
            },
            {
              sourceKind: "jobicy",
              skills: [
                ["sql", true],
                ["rest_apis", true],
                ["docker", false],
              ],
            },
          ],
          "rrhh_it",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["sourcing", true],
              ["ats", true],
            ],
          },
        ),
      };
    case "mariana":
      return {
        ...base,
        name: "Mariana Ficticia",
        role: "abogacia",
        roleGroup: "Derecho, contabilidad y gestión",
        country: "AR",
        cefr: "C1",
        years: "5",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Mariana: abogada corporativa con cinco años de experiencia en redacción de contratos comerciales, cumplimiento societario y litigios civiles.",
        skills: [
          { slug: "contract_drafting", level: 3 },
          { slug: "corporate_law", level: 3 },
          { slug: "litigation", level: 2 },
          { slug: "legal_tools", level: 2 },
        ],
        offers: offers(
          tag,
          "Legales",
          "abogacia",
          [
            {
              sourceKind: "jobicy",
              skills: [
                ["contract_drafting", true],
                ["corporate_law", true],
                ["legal_tools", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["contract_drafting", true],
                ["labor_law", true],
                ["litigation", false],
              ],
            },
            {
              sourceKind: "getonboard_api",
              skills: [
                ["corporate_law", true],
                ["legal_tools", true],
                ["contract_drafting", false],
              ],
            },
          ],
          "backend",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["nodejs", true],
              ["docker", true],
            ],
          },
        ),
      };
    case "camila":
      return {
        ...base,
        name: "Camila Ficticia",
        role: "comunicacion",
        roleGroup: "Comunicación y relaciones",
        country: "UY",
        cefr: "B2",
        years: "4",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Camila: especialista en comunicación institucional, redacción de gacetillas, relación con medios de prensa y comunicación interna para empresas.",
        skills: [
          { slug: "press_relations", level: 3 },
          { slug: "corporate_communications", level: 3 },
          { slug: "copywriting", level: 2 },
          { slug: "audiovisual", level: 1 },
        ],
        offers: offers(
          tag,
          "Comunicación",
          "comunicacion",
          [
            {
              sourceKind: "jobicy",
              skills: [
                ["press_relations", true],
                ["corporate_communications", true],
                ["copywriting", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["corporate_communications", true],
                ["copywriting", true],
                ["audiovisual", false],
              ],
            },
            {
              sourceKind: "getonboard_api",
              skills: [
                ["press_relations", true],
                ["copywriting", true],
                ["corporate_communications", false],
              ],
            },
          ],
          "data_analyst",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["sql", true],
              ["power_bi", true],
            ],
          },
        ),
      };
    case "agustina":
      return {
        ...base,
        name: "Agustina Ficticia",
        role: "finanzas_contabilidad",
        roleGroup: "Derecho, contabilidad y gestión",
        country: "AR",
        cefr: "B1",
        years: "6",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Agustina: contadora con seis años en estudios contables, liquidación de impuestos, conciliaciones y balances para pymes.",
        skills: [
          { slug: "tax_compliance", level: 3 },
          { slug: "general_accounting", level: 3 },
          { slug: "erp_accounting", level: 2 },
          { slug: "excel", level: 2 },
        ],
        offers: offers(
          tag,
          "Contaduría",
          "finanzas_contabilidad",
          [
            {
              sourceKind: "jobicy",
              skills: [
                ["general_accounting", true],
                ["tax_compliance", true],
                ["erp_accounting", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["tax_compliance", true],
                ["excel", true],
                ["financial_reporting", false],
              ],
            },
            {
              sourceKind: "getonboard_api",
              skills: [
                ["general_accounting", true],
                ["erp_accounting", true],
                ["excel", false],
              ],
            },
          ],
          "backend",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["nodejs", true],
              ["docker", true],
            ],
          },
        ),
      };
    case "bruno":
      return {
        ...base,
        name: "Bruno Ficticio",
        role: "administracion_empresas",
        roleGroup: "Derecho, contabilidad y gestión",
        country: "UY",
        cefr: "B2",
        years: "7",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Bruno: administrador de empresas con siete años en compras, mejora de procesos y control de gestión en una industria mediana.",
        skills: [
          { slug: "procurement", level: 3 },
          { slug: "process_improvement", level: 2 },
          { slug: "management_control", level: 2 },
          { slug: "excel", level: 3 },
        ],
        offers: offers(
          tag,
          "Administración",
          "administracion_empresas",
          [
            {
              sourceKind: "jobicy",
              skills: [
                ["procurement", true],
                ["process_improvement", true],
                ["excel", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["management_control", true],
                ["excel", true],
                ["business_strategy", false],
              ],
            },
            {
              sourceKind: "getonboard_api",
              skills: [
                ["procurement", true],
                ["management_control", true],
                ["process_improvement", false],
              ],
            },
          ],
          "data_analyst",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["sql", true],
              ["power_bi", true],
            ],
          },
        ),
      };
    case "rocio":
      return {
        ...base,
        name: "Rocío Ficticia",
        role: "marketing_digital",
        roleGroup: "Comunicación y relaciones",
        country: "CO",
        cefr: "B2",
        years: "4",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Rocío: especialista en relaciones públicas y marketing de contenidos, con eventos, redes sociales y newsletters para marcas de consumo.",
        skills: [
          { slug: "social_media", level: 3 },
          { slug: "copywriting", level: 2 },
          { slug: "canva", level: 3 },
          { slug: "email_marketing", level: 1 },
        ],
        offers: offers(
          tag,
          "RRPP",
          "marketing_digital",
          [
            {
              sourceKind: "jobicy",
              skills: [
                ["social_media", true],
                ["copywriting", true],
                ["canva", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["copywriting", true],
                ["email_marketing", true],
                ["social_media", false],
              ],
            },
            {
              sourceKind: "getonboard_api",
              skills: [
                ["social_media", true],
                ["canva", true],
                ["email_marketing", false],
              ],
            },
          ],
          "backend",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["nodejs", true],
              ["docker", true],
            ],
          },
        ),
      };
    case "ines":
      return {
        ...base,
        name: "Inés Ficticia",
        role: "relaciones_internacionales",
        roleGroup: "Comunicación y relaciones",
        country: "PE",
        cefr: "C1",
        years: "5",
        remoteOnly: true,
        summary:
          "Perfil ficticio de la persona Inés: licenciada en relaciones internacionales con cinco años en comercio exterior, cooperación internacional y formulación de proyectos.",
        skills: [
          { slug: "foreign_trade", level: 2 },
          { slug: "international_cooperation", level: 3 },
          { slug: "grant_writing", level: 2 },
          { slug: "trade_agreements", level: 2 },
        ],
        offers: offers(
          tag,
          "Relaciones internacionales",
          "relaciones_internacionales",
          [
            {
              sourceKind: "jobicy",
              skills: [
                ["foreign_trade", true],
                ["trade_agreements", true],
                ["grant_writing", false],
              ],
            },
            {
              sourceKind: "remoteok",
              skills: [
                ["international_cooperation", true],
                ["grant_writing", true],
                ["public_affairs", false],
              ],
            },
            {
              sourceKind: "getonboard_api",
              skills: [
                ["foreign_trade", true],
                ["international_cooperation", true],
                ["diplomacy", false],
              ],
            },
          ],
          "data_analyst",
          {
            sourceKind: "getonboard_api",
            skills: [
              ["sql", true],
              ["power_bi", true],
            ],
          },
        ),
      };
  }
}

export const PERSONA_KEYS: PersonaKey[] = [
  "lucia",
  "valentina",
  "martin",
  "tomas",
  "mariana",
  "camila",
  "agustina",
  "bruno",
  "rocio",
  "ines",
];
