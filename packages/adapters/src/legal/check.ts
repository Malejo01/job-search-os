import { legalMissing, type LegalEnv } from "@job-search-os/pipeline";

/**
 * `pnpm legal:check` (C8-12): qué falta para dar los textos legales por vigentes. Recibe el contenido de
 * cada archivo y las variables (`process.env`); devuelve las líneas para imprimir y si hay que fallar.
 * Con `final` (LEGAL_FINAL=1), cualquier faltante es un error. No cambia ningún texto.
 */
export type LegalCheckResult = { ok: boolean; missing: number; lines: string[] };

export function runLegalCheck(input: {
  files: readonly { path: string; content: string }[];
  env: LegalEnv;
  final: boolean;
}): LegalCheckResult {
  const lines: string[] = [];
  let missing = 0;
  for (const f of input.files) {
    for (const m of legalMissing(f.content, input.env)) {
      missing++;
      lines.push(
        m.envKey
          ? `${f.path}:${m.line}  ${m.marker}  → falta la variable ${m.envKey}`
          : `${f.path}:${m.line}  ${m.marker}…  → hay que reescribir el texto (marca de borrador)`,
      );
    }
  }
  if (missing === 0) lines.push("Textos legales completos: no queda ningún marcador.");
  else lines.push(`${missing} pendiente(s). Detalle y preguntas en docs/legal/preguntas-ani.md.`);
  return { ok: !(input.final && missing > 0), missing, lines };
}
