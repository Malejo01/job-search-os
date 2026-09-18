/**
 * RawJob: oferta normalizada por un adapter de fuente (Get on Board, email, manual), sin LLM.
 * Es la entrada del pipeline de ingesta (dedup → prefiltro → cola). Sin I/O: solo datos.
 */
export type SourceKind =
  | "getonboard_api"
  | "email_linkedin"
  | "email_getonboard"
  | "email_generic"
  | "manual"
  | "hn_whoishiring"
  | "remotive"
  | "other";

export type Modality = "remoto" | "hibrido" | "presencial" | "desconocida";

export type RawJob = {
  source: {
    kind: SourceKind;
    /** Nombre legible de la fuente: "GoB programming", "alerta AI Engineer" */
    name: string;
    /** Id en la fuente (slug de GoB, id de LinkedIn) */
    externalId: string | null;
    url: string | null;
    /** Referencia al crudo ya guardado (el email entero, por ejemplo). Si está, la ingesta la usa. */
    rawRef: string | null;
    /**
     * Payload tal como llegó de la fuente, antes de mapear o limpiar (item de la API, input
     * manual). La ingesta lo guarda en raw_blobs antes de procesar (JS-024). Sin esto ni rawRef,
     * se guarda el RawJob mismo.
     */
    original?: { contentType: string; body: string } | null;
  };
  title: string;
  companyRaw: string;
  locationRaw: string | null;
  /** ISO-2; ["*"] = cualquier país; null = desconocido */
  countriesAllowed: string[] | null;
  modality: Modality;
  contractType: string | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: "mensual" | "anual" | "hora" | null;
  salaryNote: string | null;
  weeklyHours: number | null;
  candidatesCount: number | null;
  badges: string[];
  /** Texto plano de la descripción completa; null → pendiente_jd */
  jdText: string | null;
  postedAt: Date | null;
  /** Etiquetas de la fuente (tags de GoB), para skills en fase 2 */
  tags: string[];
  seniority: string | null;
  lang: string | null;
};

/** Entrada de la ingesta manual (UI /jobs/new y tool MCP add_job). */
export type ManualJobInput = {
  url: string | null;
  title: string;
  company: string;
  locationRaw: string | null;
  modality: Modality;
  jdText: string | null;
  salaryMinUsd?: number | null;
  salaryMaxUsd?: number | null;
  candidatesCount?: number | null;
};

const MODALITIES: readonly Modality[] = ["remoto", "hibrido", "presencial", "desconocida"];

export function parseModality(raw: string | null | undefined): Modality {
  return (MODALITIES as readonly string[]).includes(raw ?? "") ? (raw as Modality) : "desconocida";
}

/**
 * RawJob desde una carga manual. Regla de ubicación (2026-09-11): `countriesAllowed` queda null
 * (solo el aviso puede listar países; antes "remoto" ponía ["*"] y el prefiltro nunca marcaba
 * `location_risk` en lo cargado a mano o por MCP, que es justo lo que viene de LinkedIn). Un
 * remoto sin ubicación escrita se registra como "remoto (sin país indicado)" para que el
 * prefiltro lo trate como remoto sin país explícito: riesgo, nunca descarte.
 */
export function rawJobFromManual(input: ManualJobInput, now = new Date()): RawJob {
  const url = input.url?.trim() || null;
  const location = input.locationRaw?.trim() || null;
  return {
    source: {
      kind: "manual",
      name: "manual",
      externalId: null,
      url,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(input) },
    },
    title: input.title.trim(),
    companyRaw: input.company.trim(),
    locationRaw: location ?? (input.modality === "remoto" ? "remoto (sin país indicado)" : null),
    countriesAllowed: null,
    modality: input.modality,
    contractType: null,
    salaryMinUsd: input.salaryMinUsd ?? null,
    salaryMaxUsd: input.salaryMaxUsd ?? null,
    salaryPeriod: input.salaryMinUsd || input.salaryMaxUsd ? "mensual" : null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: input.candidatesCount ?? null,
    badges: [],
    jdText: input.jdText?.trim() || null,
    postedAt: now,
    tags: [],
    seniority: null,
    lang: null,
  };
}
