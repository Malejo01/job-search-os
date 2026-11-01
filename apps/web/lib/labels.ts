/** Etiquetas de UI (español) para los enums del schema. Sin lógica: solo texto y color. */
export const STATUS_LABELS: Record<string, string> = {
  nueva: "Nueva",
  prefiltrada: "Lista para evaluar",
  descartada_prefiltro: "Descartada automáticamente",
  pendiente_jd: "Sin descripción",
  evaluada: "Evaluada",
  aplicada: "Aplicada",
  descartada: "Descartada",
  rechazo_automatico: "Rechazo automático",
  rechazada: "Rechazada",
  entrevista: "Entrevista",
  oferta: "Oferta",
  cerrada: "Cerrada",
};

export const SOURCE_LABELS: Record<string, string> = {
  getonboard_api: "Get on Board",
  email_linkedin: "LinkedIn (email)",
  email_getonboard: "Get on Board (email)",
  email_generic: "Email",
  manual: "Manual",
  hn_whoishiring: "HN Who is hiring",
  remotive: "Remotive",
  remoteok: "Remote OK",
  jobicy: "Jobicy",
  himalayas: "Himalayas",
  wwr: "We Work Remotely",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  teamtailor: "Teamtailor",
  other: "Otra",
};

export const LOCATION_LABELS: Record<string, string> = {
  ok: "Ubicación ok",
  riesgo: "Ubicación: riesgo",
  no: "Ubicación: no",
};

export const MODALITY_LABELS: Record<string, string> = {
  remoto: "remoto",
  hibrido: "híbrido",
  presencial: "presencial",
  desconocida: "modalidad sin dato",
};

export const OUTCOME_LABELS: Record<string, string> = {
  sin_respuesta: "Sin respuesta",
  rechazo_automatico_ubicacion: "Rechazo automático (ubicación)",
  rechazo_automatico_otro: "Rechazo automático (otro)",
  rechazo_humano: "Rechazo humano",
  entrevista: "Entrevista",
  oferta: "Oferta",
  cerrada_antes: "Cerrada antes de responder",
  retirada: "Retirada",
};

export const ACTION_LABELS: Record<string, string> = {
  aplicar_personalizado: "Aplicar (personalizado)",
  aplicar: "Aplicar",
  guardar: "Guardar",
  descartar: "Descartar",
};

/** La acción sugerida por la evaluación, dicha como consejo (detalle de la oferta). */
export const ACTION_ADVICE: Record<string, string> = {
  aplicar_personalizado: "Te conviene: postularte con una carta a medida",
  aplicar: "Te conviene: postularte",
  guardar: "Te conviene: guardarla",
  descartar: "Te conviene: descartarla",
};

/** Estados "activos": lo que se muestra por defecto en la lista (lo descartado o cerrado queda detrás de un filtro). */
export const ACTIVE_STATUSES = [
  "nueva",
  "prefiltrada",
  "pendiente_jd",
  "evaluada",
  "aplicada",
  "entrevista",
  "oferta",
] as const;

/** evaluations.model del modo demo (adapters/llm/demo.ts): la UI lo marca con badge DEMO. */
export const DEMO_MODEL = "fake";
export const DEMO_BADGE_CLASSES =
  "rounded-badge bg-brand px-1.5 py-0.5 text-xs font-semibold text-brand-contrast";

export function scoreTone(score: number | null): "alto" | "medio" | "bajo" | "none" {
  if (score === null) return "none";
  if (score >= 7) return "alto";
  if (score >= 5) return "medio";
  return "bajo";
}

/** Caja del puntaje (/hoy, /jobs, detalle y demo). Tokens de docs/ux/tokens.md: cambian solos en oscuro. */
export const SCORE_CLASSES: Record<ReturnType<typeof scoreTone>, string> = {
  alto: "bg-success-muted text-success ring-success-line",
  medio: "bg-warning-muted text-warning ring-warning-line",
  bajo: "bg-surface-muted text-fg-muted ring-line-strong",
  none: "bg-surface-subtle text-fg-subtle ring-line",
};

/** Tono del badge de ubicación (`Badge` de components/ui): ok, riesgo o no. */
export const LOCATION_TONES: Record<string, "success" | "warning" | "danger"> = {
  ok: "success",
  riesgo: "warning",
  no: "danger",
};

/** Clases del mismo badge para quien todavía no usa `Badge` (detalle de la oferta). */
export const LOCATION_CLASSES: Record<string, string> = {
  ok: "bg-success-soft text-success",
  riesgo: "bg-warning-soft text-warning",
  no: "bg-danger-soft text-danger",
};

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

/**
 * Cómo se muestra `inbound_emails.parser` en /inbox. El ruido social de LinkedIn (JS-050) se
 * guarda con su propio valor y ya descartado: se lee como "no relevante". Sin lector (null o
 * "none") el email espera en la cola manual.
 */
export function parserLabel(parser: string | null): string {
  if (parser === "linkedin_social") return "no relevante: notificación social de LinkedIn";
  if (parser === null || parser === "none") return "no se pudo leer automáticamente";
  if (parser === "gmail_reenvio") return "reenvío de Gmail";
  return "leído automáticamente";
}

/**
 * El error de un email viene de la ingesta y habla de "parser" y "cola manual". Se muestra en
 * llano; lo que no menciona un parser queda como está.
 */
export function inboundErrorLabel(error: string): string {
  return /parser/i.test(error) ? "No pudimos leer este email automáticamente." : error;
}

/** Flags del prefiltro en llano. `null` = no se muestra (reglas internas o desconocidas). */
export function flagLabel(flag: string): string | null {
  if (flag.startsWith("domain_keyword:")) {
    const domain = flag.slice("domain_keyword:".length).trim();
    return domain ? `dominio: ${domain}` : null;
  }
  switch (flag) {
    case "location_risk":
      return LOCATION_RISK_TEXT;
    case "many_candidates":
      return "muchos postulantes";
    case "modalidad_no_remota":
      return "híbrida o presencial";
    case "ciudad_distinta":
      return "la ciudad del aviso no es la de tu perfil";
    case "skills_match_high":
      return "buena coincidencia de aptitudes";
    case "volume_recruiting":
      return "búsqueda masiva";
    case "fuera_de_areas":
      return "fuera de las áreas que elegiste";
    default:
      return null;
  }
}

/** Riesgos de la evaluación: ya vienen en castellano, salvo `location_ok = <valor>`. */
export function riskLabel(text: string): string {
  const m = /^location_ok\s*=\s*(\S+)$/.exec(text.trim());
  if (!m) return text;
  return m[1] === "no" ? "tu país no está entre los permitidos" : LOCATION_RISK_TEXT;
}

/** Lo que implica el riesgo de ubicación, en llano (ronda 44). */
export const LOCATION_RISK_TEXT =
  "El aviso no dice desde qué países contrata: confirmalo antes de postular";

/** Score con escala y coma decimal: 7,5/10. Solo para mostrar; los aria-label siguen con punto. */
export function formatScore(score: number): string {
  return `${formatScoreNumber(score)}/10`;
}

/** Solo el número (7,5), para cuando la escala "/10" va en otro elemento. */
export function formatScoreNumber(score: number): string {
  return score.toFixed(score % 1 ? 1 : 0).replace(".", ",");
}

/** Textos de la «estimación previa» (antes «pre-score»): una línea visible, no solo un title. */
export const PRE_SCORE_EXPLAIN =
  "Estimación previa: la calculamos con reglas, sin IA, mirando tus skills, los riesgos y el salario. Todavía no es la evaluación.";
export const BLOCKER_LABEL = "Impide postular";

export const DISCIPLINE_LABEL: Record<string, string> = {
  ai_engineer: "Ingeniería de IA",
  ml_engineer: "Ingeniería de ML",
  ai_evaluation: "Evaluación de IA",
  creative_production: "Producción creativa con IA",
  fullstack: "Fullstack",
  frontend: "Frontend",
  backend: "Backend",
  devops: "DevOps",
  data: "Datos",
  ciberseguridad: "Ciberseguridad",
  negocio: "Negocio",
  project_management: "Gestión de proyectos",
  administracion_plataformas: "Administración de plataformas",
  arquitectura: "Arquitectura",
  otra: "Otra",
  marketing_digital: "Marketing digital",
  producto: "Producto",
  recursos_humanos: "Recursos humanos / recruiting",
  customer_success: "Customer success",
};

export const ENGLISH_LABEL: Record<string, string> = {
  no_menciona: "no lo menciona",
  no: "no pide",
  basico: "básico",
  intermedio: "intermedio",
  avanzado: "avanzado",
  nativo: "nativo",
};

export const COMPANY_TYPE_LABEL: Record<string, string> = {
  producto: "producto",
  startup: "startup",
  consultora: "consultora",
  staffing: "staffing",
  agencia: "agencia",
  desconocido: "no se sabe",
};

export const SKILL_CATEGORY_LABEL: Record<string, string> = {
  cloud: "nube",
  infra: "infraestructura",
  testing: "pruebas",
  llm_ops: "operación de modelos",
  ai_core: "IA",
  lenguaje: "lenguajes",
  framework: "frameworks",
  datos: "datos",
  soft: "habilidades blandas",
  idioma: "idiomas",
  dominio: "dominio",
  otra: "otra",
};

export const ADJUSTMENT_LABEL: Record<string, string> = {
  title_cap: "tope por el título",
  years_penalty: "piden muchos años",
  years_gap_penalty: "faltan años de experiencia",
  discipline_cap: "disciplina fuera de tu perfil",
  injection_cap: "aviso con instrucciones al evaluador",
  cloud_must_penalty: "exigen infraestructura que no tenés",
  english_fluent_penalty: "piden inglés fluido",
  sin_skills: "sin aptitudes reconocidas en la descripción",
  cobertura: "cobertura de aptitudes",
  riesgo_dominio: "dominio de riesgo",
  riesgo_location_risk: LOCATION_RISK_TEXT,
  salario_bajo_piso: "salario por debajo de tu piso",
};

/** Estado de un requisito del aviso (ronda 104): ícono + texto, nunca solo color. */
export const CHECKLIST_STATUS: Record<
  "cumple" | "no_cumple" | "no_se_sabe",
  { icon: string; label: string; classes: string }
> = {
  cumple: { icon: "✓", label: "Cumple", classes: "bg-success-soft text-success" },
  no_cumple: { icon: "✗", label: "No cumple", classes: "bg-danger-soft text-danger" },
  no_se_sabe: { icon: "?", label: "No se sabe", classes: "bg-surface-muted text-fg" },
};

/** De dónde sale cada lado de un requisito. */
export const CHECKLIST_PIDE_SOURCE: Record<"fuente" | "modelo", string> = {
  fuente: "del aviso",
  modelo: "según la evaluación",
};
export const CHECKLIST_TENES_SOURCE: Record<"perfil" | "skills", string> = {
  perfil: "de tu perfil",
  skills: "de tu perfil",
};

/** Un ajuste de score en llano: el detalle que ya trae, o la etiqueta de la regla. */
export function adjustmentText(a: { rule: string; delta: number; detail?: string | null }): string {
  const what = a.detail?.trim() || ADJUSTMENT_LABEL[a.rule] || "ajuste automático";
  return `${what} ${a.delta > 0 ? "+" : ""}${a.delta}`;
}

/** Solo se enlaza lo que es http(s): una URL guardada puede venir de cualquier fuente. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
