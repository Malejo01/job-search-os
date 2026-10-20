import type { ProfileForPrompt } from "../evaluation";
import { criteriaFromOnboarding } from "../onboarding";
import type { CriteriaRules } from "../criteria";
import type { RoleKey } from "../skills/self-assessment";

/**
 * Perfiles de la demo guiada (ronda 74). Son personas INVENTADAS: nada sale de usuarios reales.
 * Los criterios son los de una persona nueva en el onboarding (`criteriaFromOnboarding`), sin reglas propias.
 */
export const DEMO_PROFILE_KEYS = ["data_analyst_jr", "fullstack_ssr", "ai_engineer"] as const;
export type DemoProfileKey = (typeof DEMO_PROFILE_KEYS)[number];

export type DemoProfile = {
  key: DemoProfileKey;
  /** Lo que ve la gente en la tarjeta. */
  label: string;
  /** Una línea para la tarjeta del índice. */
  tagline: string;
  targetRoles: readonly RoleKey[];
  profile: ProfileForPrompt & { targetRoles: readonly RoleKey[] };
};

const BASE = {
  locationCountry: "AR",
  locationCity: null,
  remoteOnly: true,
  workAuth: { us: false, eu: false },
  salaryFloorUsd: null,
  maxWeeklyHours: null,
} as const;

export const DEMO_PROFILES: readonly DemoProfile[] = [
  {
    key: "data_analyst_jr",
    label: "Data analyst junior",
    tagline: "Primer empleo en datos, con SQL y dashboards de proyectos propios.",
    targetRoles: ["data_analyst"],
    profile: {
      ...BASE,
      englishCefr: "B1",
      yearsTotal: 1,
      targetRoles: ["data_analyst"],
      profileSummary: [
        "Analista de datos junior con un año de experiencia en prácticas y proyectos propios.",
        "Trabaja con SQL (consultas con joins y agregaciones) y arma tableros en Power BI y Looker Studio.",
        "Usa Python con pandas para limpiar datos y Excel avanzado para reportes del día a día.",
        "Busca su primer puesto de analista en remoto, en un equipo que lo acompañe a crecer.",
        "Inglés intermedio: lee documentación sin problema y participa en reuniones con apoyo.",
      ].join("\n"),
    },
  },
  {
    key: "fullstack_ssr",
    label: "Full stack semi senior",
    tagline: "Cuatro años entre React y Node, con foco en productos web.",
    targetRoles: ["fullstack"],
    profile: {
      ...BASE,
      englishCefr: "B2",
      yearsTotal: 4,
      targetRoles: ["fullstack"],
      profileSummary: [
        "Desarrollador full stack semi senior con cuatro años de experiencia en productos web.",
        "Frontend con React y TypeScript; backend con Node.js, APIs REST y PostgreSQL.",
        "Despliega en AWS con contenedores y pipelines de CI, y escribe tests de integración.",
        "Busca un puesto remoto en una empresa de producto, con equipo chico y ownership.",
        "Inglés intermedio alto: trabaja con equipos distribuidos en reuniones y por escrito.",
      ].join("\n"),
    },
  },
  {
    key: "ai_engineer",
    label: "AI engineer",
    tagline: "Aplicaciones con LLMs: RAG, agentes y evaluación.",
    targetRoles: ["ai_engineer"],
    profile: {
      ...BASE,
      englishCefr: "C1",
      yearsTotal: 5,
      targetRoles: ["ai_engineer"],
      profileSummary: [
        "Ingeniero de IA con cinco años de experiencia en software y dos construyendo aplicaciones con LLMs.",
        "Diseña sistemas RAG con bases vectoriales, agentes con herramientas y flujos de evaluación automática.",
        "Programa en Python y TypeScript, y despliega servicios en la nube con trazabilidad de costos.",
        "Busca un rol remoto donde llevar productos con IA a producción, no solo prototipos.",
        "Inglés avanzado: presenta y documenta decisiones técnicas con equipos internacionales.",
      ].join("\n"),
    },
  },
];

export function isDemoProfileKey(v: unknown): v is DemoProfileKey {
  return typeof v === "string" && (DEMO_PROFILE_KEYS as readonly string[]).includes(v);
}

export function getDemoProfile(key: string): DemoProfile | null {
  return DEMO_PROFILES.find((p) => p.key === key) ?? null;
}

/** Mismos criterios por defecto que recibe una persona nueva en el onboarding. */
export function demoCriteriaRules(): CriteriaRules {
  return criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null });
}
