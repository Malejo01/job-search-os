import { voiceServerAllowed, voiceServerMode } from "@job-search-os/pipeline";
import { getSessionEmail } from "@/lib/profile-agent/access";
import { testerEnvFor } from "../user-roles";

/**
 * Parte de servidor de la voz (R25-03). Solo de servidor: lee `VOICE_SERVER_TRANSCRIBE`, `ADMIN_EMAILS` y la
 * base. Las páginas (Server Components) le pasan `serverTranscribe: boolean` al componente `VoiceInput`; el
 * navegador nunca ve la variable. La ruta `POST /api/transcribe` vuelve a decidir con la misma función.
 */

/**
 * ¿Esta persona puede transcribir en el servidor? Con `VOICE_SERVER_TRANSCRIBE` apagado no consulta la base;
 * ante un error de la consulta, no (falla cerrado). El modo `testers` mira el email de la sesión.
 */
export async function voiceServerAllowedFor(userId: string): Promise<boolean> {
  const mode = voiceServerMode(process.env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  try {
    const email = await getSessionEmail(userId);
    return voiceServerAllowed(await testerEnvFor(userId, email), email);
  } catch {
    return false;
  }
}

export type LimitedBytes = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" };

/**
 * Lee el cuerpo de un pedido con tope de bytes, sin pasarlo a texto (es audio). Mismas dos defensas que
 * `readBodyLimited`: un `Content-Length` declarado mayor al tope se rechaza sin leer, y la lectura real se
 * corta apenas se pasa. Todo queda en memoria; nada se escribe a disco.
 */
export async function readBytesLimited(request: Request, maxBytes: number): Promise<LimitedBytes> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d{1,15}$/.test(declared.trim()) && Number(declared) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: all };
}
