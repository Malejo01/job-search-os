import type { SeedPublicJob } from "../helpers";

/**
 * Personas sintéticas de la ronda 42. Todo inventado: nombres, emails (`@personas.test`), perfiles
 * y avisos (`Empresa Ficticia`). Ninguna se parece al perfil real del dueño del producto. Cada una
 * tiene 3 ofertas de su puesto y 1 de otro puesto (control negativo: no tiene que aparecer).
 * Para sumar una persona, ver docs/panel/personas-e2e.md.
 */
export type PersonaKey = "lucia" | "valentina" | "martin" | "tomas";

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
  roleGroup: "Tecnología" | "Carreras digitales";
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
        roleGroup: "Carreras digitales",
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
  }
}

export const PERSONA_KEYS: PersonaKey[] = ["lucia", "valentina", "martin", "tomas"];
