/**
 * Transcripción falsa (`transcribe_audio`, R25-03) para `LLM_DEMO=1`, los e2e y los tests: no oye el audio.
 * Devuelve un texto fijo según la duración (`duration_seconds` llega como variable del prompt). Para probar
 * que un audio con una orden dirigida a la IA se transcribe literal sin obedecerla, un audio de prueba puede
 * llevar el marcador `DEMO_SAY:` seguido del texto que "dice": el fake lo devuelve tal cual (nunca lo ejecuta).
 */
export const DEMO_TRANSCRIPTION_SAY_MARK = "DEMO_SAY:";

export const DEMO_TRANSCRIPTION_SHORT = "Trabajé tres años con SQL y Excel.";
export const DEMO_TRANSCRIPTION_MEDIUM =
  "Trabajé tres años como analista de datos, armando reportes semanales con SQL y Excel para el equipo comercial.";
export const DEMO_TRANSCRIPTION_LONG = `${DEMO_TRANSCRIPTION_MEDIUM} También automaticé la carga de datos y fui el contacto del equipo con las áreas que pedían los reportes.`;

const MAX_SAY_CHARS = 2_000;

export function demoTranscription(
  vars: Record<string, string | number | boolean>,
  audio?: Uint8Array,
): { text: string } {
  if (audio && audio.length > 0) {
    const latin1 = Buffer.from(audio).toString("latin1");
    const at = latin1.indexOf(DEMO_TRANSCRIPTION_SAY_MARK);
    if (at >= 0) {
      const rest = Buffer.from(audio.subarray(at + DEMO_TRANSCRIPTION_SAY_MARK.length)).toString(
        "utf8",
      );
      const end = rest.indexOf("\u0000");
      return { text: (end >= 0 ? rest.slice(0, end) : rest).slice(0, MAX_SAY_CHARS).trim() };
    }
  }
  const seconds = Number(vars.duration_seconds);
  if (!Number.isFinite(seconds) || seconds <= 5) return { text: DEMO_TRANSCRIPTION_SHORT };
  return { text: seconds <= 30 ? DEMO_TRANSCRIPTION_MEDIUM : DEMO_TRANSCRIPTION_LONG };
}
