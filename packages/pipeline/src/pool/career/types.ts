import type { RoleKey } from "../../skills/self-assessment";

/**
 * Mercado por carrera (ronda 58): forma de la entrada y de la salida de `buildCareerMarket`.
 * Todo es JSON plano (fechas en ISO) para que el resultado pueda ir al caché de Next tal cual.
 * Solo datos de avisos públicos del pool: nada de usuarios.
 */

/** Un aviso del pool del rol, con lo justo para los cuatro bloques. */
export type CareerJobInput = {
  id: string;
  title: string;
  seniority: string | null;
  lang: string | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  modality: string | null;
  countriesAllowed: string[] | null;
  locationRaw: string | null;
  sourceKind: string;
  /** ISO. `coalesce(posted_at, first_seen_at)`. */
  publishedAt: string;
  jdText: string | null;
};

export type CareerSkillInput = { jobId: string; slug: string; name: string; isMust: boolean };

export type CareerMarketInput = {
  role: RoleKey;
  jobs: CareerJobInput[];
  skills: CareerSkillInput[];
  /** ISO de `max(last_seen_at)` de todo el pool, o null si el pool está vacío. */
  poolUpdatedAt: string | null;
  /** ISO del momento del cálculo. */
  now: string;
};

export type CareerSkillRow = {
  slug: string;
  name: string;
  /** Avisos que la piden (excluyente o deseable). */
  jobs: number;
  must: number;
  nice: number;
  /** jobs / total, entre 0 y 1. */
  share: number;
};

export type SeniorityBucket = "junior" | "semi" | "senior" | "lead" | "unknown";
export type EnglishLevel = "basico" | "intermedio" | "avanzado" | "fluido";

export type CareerMarket = {
  role: RoleKey;
  total: number;
  smallSample: boolean;
  computedAt: string;
  poolUpdatedAt: string | null;
  skills: CareerSkillRow[];
  seniority: { counts: Record<SeniorityBucket, number> };
  english: {
    /** Avisos que piden inglés (en cualquier idioma del aviso). */
    asks: number;
    levels: Record<EnglishLevel | "sin_nivel", number>;
    /** Avisos escritos en inglés (pidan o no inglés explícitamente). */
    writtenInEnglish: number;
    /** true si la precisión medida del detector quedó < 85 %: la UI dice "estimado". */
    estimated: boolean;
  };
  salary: {
    informed: number;
    total: number;
    enough: boolean;
    /** USD por mes; null si `enough` es false. */
    p25: number | null;
    median: number | null;
    p75: number | null;
  };
  volume: {
    active: number;
    new24h: number;
    modality: Record<"remoto" | "hibrido" | "presencial" | "desconocida", number>;
    fromArgentina: Record<"acepta" | "no_acepta" | "no_dice", number>;
    sources: { name: string; jobs: number }[];
  };
};
