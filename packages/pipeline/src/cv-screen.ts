/**
 * Estado de la pantalla «Tu CV» (R33-01, C-01, C-02, C-04). Puro: recibe el CV ya armado con lo que la
 * persona confirmó y decide en cuál de los tres estados está y qué falta. Un borrador sin confirmar no es
 * un dato: no cambia el estado, solo muestra el aviso «Tenés un borrador sin confirmar».
 *  - `empty`: nada cargado, solo los dos caminos («Tengo CV» / «No tengo CV»).
 *  - `partial`: algo cargado, «Seguir armando mi CV» y cada faltante con su botón.
 *  - `complete`: están las cinco secciones; diagnóstico y descarga.
 * Los links (LinkedIn, portfolio) son opcionales y nunca bloquean. La web traduce los códigos a textos.
 */
import type { CvDocument } from "./cv-out/model";

export type CvScreenState = "empty" | "partial" | "complete";
export type CvPendingKey = "summary" | "experience" | "education" | "skills" | "languages";

/** Orden en que se listan los faltantes. */
export const CV_PENDING_ORDER: readonly CvPendingKey[] = [
  "summary",
  "experience",
  "education",
  "skills",
  "languages",
];

export type CvScreenInput = Pick<CvDocument, "sections" | "missing">;

export interface CvScreen {
  state: CvScreenState;
  /** Lo que falta para un CV completo, en `CV_PENDING_ORDER`. Vacío si está completo. */
  pending: CvPendingKey[];
  /** Solo sin nada cargado se muestra la puerta con los dos caminos. */
  showDoor: boolean;
  /** «Tenés un borrador sin confirmar. [Retomarlo]». */
  showDraftNotice: boolean;
}

/** Secciones que satisfacen cada ítem. Proyectos valen como experiencia (quien recién empieza). */
const SATISFIED_BY: Record<CvPendingKey, readonly string[]> = {
  summary: ["summary"],
  experience: ["experience", "projects"],
  education: ["education"],
  skills: ["skills"],
  languages: ["languages"],
};

export function cvScreen(
  doc: CvScreenInput | null | undefined,
  opts: { hasDraft?: boolean } = {},
): CvScreen {
  const filled = new Set<string>(
    (doc?.sections ?? []).filter((s) => s.blocks.length > 0).map((s) => s.id),
  );
  const pending = CV_PENDING_ORDER.filter((k) => !SATISFIED_BY[k].some((id) => filled.has(id)));
  const state: CvScreenState =
    filled.size === 0 ? "empty" : pending.length === 0 ? "complete" : "partial";
  return {
    state,
    pending,
    showDoor: state === "empty",
    showDraftNotice: opts.hasDraft === true,
  };
}
