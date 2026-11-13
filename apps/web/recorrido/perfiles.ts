/**
 * Perfiles del recorrido por carreras (T-1): 2 personas por cada una de las 8 carreras de la beta, una
 * recién recibida sin experiencia y otra con 2 o 3 años. Todo inventado: nombres «Ficticia/o», empresas
 * «Empresa A…», sin datos de nadie. El email de la cuenta es `<prefijo>-<nivel>@<dominio>`; el prefijo y
 * el nivel dicen qué perfil se usa (docs/beta/test-users.example.txt). Las claves de carrera y de skills
 * son las del seed del repo (`role_skills.json`, `skills.json`).
 */
export type Nivel = "junior" | "con-experiencia";

export type PerfilRecorrido = {
  /** Parte local del email: `abogacia-junior`. */
  id: string;
  name: string;
  /** Clave de la carrera (`ROLE_KEYS`). */
  role: string;
  roleGroup: "Carreras de la beta";
  country: string;
  cefr: "A2" | "B1" | "B2" | "C1";
  years: string;
  remoteOnly: boolean;
  summary: string;
  /** Skills del catálogo de la carrera, con nivel autodeclarado (1 a 3). */
  skills: { slug: string; level: 1 | 2 | 3 }[];
  /** CV de prueba en texto, para pegarlo en el chat de CV si hace falta. */
  cvText: string;
};

type Carrera = {
  prefijo: string;
  role: string;
  titulo: string;
  /** Skills del catálogo de la carrera, de las más a las menos centrales. */
  skills: string[];
  /** Una frase de lo que hace la persona, sin empresas reales. */
  tarea: string;
  country: string;
};

const CARRERAS: Carrera[] = [
  {
    prefijo: "abogacia",
    role: "abogacia",
    titulo: "abogada",
    skills: ["contract_drafting", "corporate_law", "labor_law", "litigation"],
    tarea: "redacción de contratos y asesoramiento societario",
    country: "AR",
  },
  {
    prefijo: "finanzas",
    role: "finanzas_contabilidad",
    titulo: "contadora",
    skills: ["general_accounting", "tax_compliance", "erp_accounting", "financial_reporting"],
    tarea: "conciliaciones, liquidación de impuestos y balances",
    country: "AR",
  },
  {
    prefijo: "administracion",
    role: "administracion_empresas",
    titulo: "administrador de empresas",
    skills: ["procurement", "process_improvement", "management_control", "business_strategy"],
    tarea: "compras, mejora de procesos y tableros de gestión",
    country: "UY",
  },
  {
    prefijo: "comunicacion",
    role: "comunicacion",
    titulo: "comunicadora",
    skills: ["press_relations", "corporate_communications", "copywriting", "audiovisual"],
    tarea: "gacetillas, comunicación interna y contenidos",
    country: "UY",
  },
  {
    prefijo: "marketing",
    role: "marketing_digital",
    titulo: "especialista en marketing digital",
    skills: ["seo", "google_ads", "social_media", "email_marketing"],
    tarea: "campañas pagas, posicionamiento y newsletters",
    country: "MX",
  },
  {
    prefijo: "relaciones-publicas",
    role: "relaciones_publicas",
    titulo: "especialista en relaciones públicas",
    skills: ["press_relations", "event_management", "social_media", "crisis_management"],
    tarea: "vínculo con medios, eventos y comunicación de crisis",
    country: "CO",
  },
  {
    prefijo: "relaciones-internacionales",
    role: "relaciones_internacionales",
    titulo: "licenciada en relaciones internacionales",
    skills: ["foreign_trade", "international_cooperation", "grant_writing", "trade_agreements"],
    tarea: "comercio exterior, cooperación y formulación de proyectos",
    country: "PE",
  },
  {
    prefijo: "programacion",
    role: "fullstack",
    titulo: "desarrolladora full-stack",
    skills: ["typescript", "react", "nodejs", "git"],
    tarea: "aplicaciones web con TypeScript, React y Node.js",
    country: "AR",
  },
];

const NOMBRES: Record<string, [string, string]> = {
  abogacia: ["Abril Ficticia", "Alma Ficticia"],
  finanzas: ["Florencia Ficticia", "Felisa Ficticia"],
  administracion: ["Andrés Ficticio", "Ariel Ficticio"],
  comunicacion: ["Carolina Ficticia", "Celeste Ficticia"],
  marketing: ["Mía Ficticia", "Micaela Ficticia"],
  "relaciones-publicas": ["Paula Ficticia", "Pilar Ficticia"],
  "relaciones-internacionales": ["Renata Ficticia", "Romina Ficticia"],
  programacion: ["Pía Ficticia", "Priscila Ficticia"],
};

function armar(c: Carrera, nivel: Nivel): PerfilRecorrido {
  const junior = nivel === "junior";
  const name = NOMBRES[c.prefijo]![junior ? 0 : 1]!;
  const years = junior ? "0" : "3";
  const empresa = junior ? "Empresa A" : "Empresa B";
  const summary = junior
    ? `Perfil ficticio de ${name}: ${c.titulo} recién recibida, sin experiencia laboral formal; hizo prácticas y proyectos de la facultad en ${c.tarea}.`
    : `Perfil ficticio de ${name}: ${c.titulo} con tres años de experiencia en ${c.tarea}, en ${empresa} y en un estudio o consultora chica (Empresa C).`;
  const cvText = junior
    ? [
        name,
        `Perfil: ${c.titulo}, recién recibida.`,
        "Formación: título de grado en una universidad ficticia (Universidad A), promedio alto.",
        `Práctica: pasantía de 3 meses en ${empresa}, tareas de ${c.tarea}.`,
        `Herramientas: ${c.skills.slice(0, 3).join(", ")}.`,
        "Idiomas: español nativo, inglés intermedio.",
      ].join("\n")
    : [
        name,
        `Perfil: ${c.titulo} con 3 años de experiencia.`,
        "Formación: título de grado en una universidad ficticia (Universidad A).",
        `2024-2026 · ${empresa}: ${c.tarea}; coordinó a una persona junior.`,
        "2023-2024 · Empresa C: asistente, primeras tareas de la misma área.",
        `Herramientas: ${c.skills.join(", ")}.`,
        "Idiomas: español nativo, inglés intermedio-alto.",
      ].join("\n");
  return {
    id: `${c.prefijo}-${nivel}`,
    name,
    role: c.role,
    roleGroup: "Carreras de la beta",
    country: c.country,
    cefr: junior ? "B1" : "B2",
    years,
    remoteOnly: true,
    summary,
    skills: c.skills.map((slug, i) => ({
      slug,
      level: junior ? (i === 0 ? 2 : 1) : i < 2 ? 3 : 2,
    })),
    cvText,
  };
}

/** Los 16 perfiles: 8 carreras por 2 niveles. */
export const PERFILES: PerfilRecorrido[] = CARRERAS.flatMap((c) => [
  armar(c, "junior"),
  armar(c, "con-experiencia"),
]);

/** El perfil de una cuenta por su email (`<prefijo>-<nivel>@…`); null si no es de ninguna carrera (p. ej. `auditoria`). */
export function perfilPorEmail(email: string): PerfilRecorrido | null {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  return PERFILES.find((p) => p.id === local) ?? null;
}
