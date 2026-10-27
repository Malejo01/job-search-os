/**
 * Tipos comunes del asistente (Fase 7, etapa 3). El asistente lee, explica y PROPONE: ninguna tool
 * escribe. Una propuesta es una diferencia antes/después que la persona carga en el formulario de
 * la pantalla y guarda ella con la Server Action de siempre.
 */

/** Pantallas con formulario donde termina una propuesta. */
export const PROPOSAL_DESTINATIONS = [
  "profile",
  "skill_levels",
  "criteria",
  "target_roles",
] as const;
export type ProposalDestination = (typeof PROPOSAL_DESTINATIONS)[number];

/** De dónde sale un valor propuesto: una cita literal de lo que escribió la persona o de su perfil. */
export type Grounding = { from: "message" | "profile"; quote: string };

/** Un campo que cambia, listo para la tarjeta de diferencia. */
export type FieldDiff = {
  field: string;
  label: string;
  before: string;
  after: string;
  source: Grounding;
};

export type DroppedReason = "sin_fundamento" | "invalido" | "sin_cambio" | "desconocido";

/**
 * Propuesta lista para la tarjeta de diferencia. NO se loguea ni se guarda: lleva citas de la
 * persona y valores de su perfil. Para logs y métricas, `proposalLogMeta`.
 */
export type Proposal = {
  destination: ProposalDestination;
  /** Pantalla con el formulario que guarda estos cambios. */
  href: string;
  /** Título de la tarjeta («Cambios para Tu perfil»). */
  title: string;
  /** Solo lo que cambia (before !== after). */
  diffs: FieldDiff[];
  /**
   * Nombre del campo del formulario → valor, para «Cargar en el formulario». SOLO los campos de
   * `diffs`: el cargador no toca nada más del formulario.
   */
  formValues: Record<string, string | string[]>;
  /** Lo que el modelo pidió y no se propone, con el motivo (sin el valor). */
  dropped: { field: string; reason: DroppedReason }[];
  /**
   * Campos NO propuestos que el formulario rechazaría al guardar (p. ej. un resumen guardado que
   * hoy no pasa la validación): la tarjeta avisa que hay que corregirlos a mano.
   */
  warnings: string[];
  /** Criterios: versión con la que se armó; si la pantalla tiene otra, no se carga. */
  criteriaVersion?: number;
};

export type ProposalError = "sin_cambios" | "entrada_invalida" | "sin_contexto";
