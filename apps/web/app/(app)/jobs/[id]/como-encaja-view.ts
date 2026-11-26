import {
  summarizeRequirements,
  type Checklist,
  type RequirementState,
} from "@job-search-os/pipeline";

export type EncajaVerdict = "excluyente" | "noCoincide" | "sinConfirmar" | "coincide" | "vacio";

export type EncajaRow = {
  id: string;
  state: RequirementState;
  nivel: "must" | "deseable";
  pide: string;
  /** Lo que el perfil tiene; null = no lo sabemos. */
  tenes: string | null;
};

export type EncajaView = {
  verdict: EncajaVerdict;
  /** Hasta 3 filas que más pesan, de la tabla de requisitos. */
  rows: EncajaRow[];
  /** La condición excluyente que no coincide, para explicarla aparte de la afinidad. */
  blocking: EncajaRow | null;
};

/**
 * «Cómo encaja» (R30-08): el veredicto y las cosas que más pesan salen de la tabla de requisitos
 * (`summarizeRequirements`), nunca de bloqueadores, gaps o riesgos sueltos. Devuelve códigos; los
 * textos los pone la pantalla.
 */
export function encajaView(checklist: Pick<Checklist, "items"> | null | undefined): EncajaView {
  const s = summarizeRequirements(checklist);
  const toRow = (r: (typeof s.rows)[number]): EncajaRow => ({
    id: r.id,
    state: r.state,
    nivel: r.nivel,
    pide: r.item.pide,
    tenes: r.item.tenes,
  });
  // El veredicto mira los requisitos excluyentes; las habilidades deseables no cuentan acá
  const must = s.rows.filter((r) => r.nivel === "must");
  const verdict: EncajaVerdict =
    s.rows.length === 0
      ? "vacio"
      : s.blocking
        ? "excluyente"
        : must.some((r) => r.state === "noCoincide")
          ? "noCoincide"
          : must.some((r) => r.state === "sinConfirmar")
            ? "sinConfirmar"
            : "coincide";
  return {
    verdict,
    rows: s.weighing.map(toRow),
    blocking: s.blocking ? toRow(s.blocking) : null,
  };
}
