/** Etiquetas de UI (español) para los enums del schema. Sin lógica: solo texto y color. */
export const STATUS_LABELS: Record<string, string> = {
  nueva: "Nueva",
  prefiltrada: "Prefiltrada",
  descartada_prefiltro: "Descartada (prefiltro)",
  pendiente_jd: "Pendiente de JD",
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
  other: "Otra",
};

export const LOCATION_LABELS: Record<string, string> = {
  ok: "Ubicación ok",
  riesgo: "Ubicación: riesgo",
  no: "Ubicación: no",
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
  "rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-900";

export function scoreTone(score: number | null): "alto" | "medio" | "bajo" | "none" {
  if (score === null) return "none";
  if (score >= 7) return "alto";
  if (score >= 5) return "medio";
  return "bajo";
}

export const SCORE_CLASSES: Record<ReturnType<typeof scoreTone>, string> = {
  alto: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  medio: "bg-amber-100 text-amber-900 ring-amber-300",
  bajo: "bg-zinc-100 text-zinc-700 ring-zinc-300",
  none: "bg-zinc-50 text-zinc-500 ring-zinc-200",
};

export const LOCATION_CLASSES: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-800",
  riesgo: "bg-amber-50 text-amber-900",
  no: "bg-red-50 text-red-800",
};

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
