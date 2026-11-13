import { adjustmentText } from "./labels";

/**
 * Un ajuste del puntaje en llano (R5-C7, hallazgo 28 de `docs/ux/auditoria-r4.md`): el ajuste de
 * «sin aptitudes reconocidas» trae delta 0 y salía como «…: se asume 5 0», sin explicación. Acá se
 * dice qué pasó y cuánto vale la estimación, y los ajustes en cero no muestran el «0».
 */
export function adjustmentLine(a: { rule: string; delta: number; detail?: string | null }): string {
  if (a.rule === "sin_skills") {
    return "no reconocimos aptitudes en la descripción: la estimación parte de 5 sobre 10";
  }
  if (a.delta === 0) return a.detail?.trim() || adjustmentText(a).replace(/ 0$/, "");
  return adjustmentText(a);
}
