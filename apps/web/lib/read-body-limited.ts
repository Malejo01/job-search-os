/**
 * Lectura del cuerpo de un pedido con tope de bytes. Sin esto, `request.text()` carga en memoria todo lo que
 * mande el cliente y recién después se mira el largo: con 2 MB hostiles ya se gastó la memoria y el parseo.
 *
 * Dos defensas, porque la primera sola no alcanza:
 * 1. `Content-Length` declarado mayor al tope: se rechaza **sin leer** el cuerpo.
 * 2. Cuerpo real mayor al tope (el header falta, miente o viene con transferencia en trozos): la lectura se
 *    corta apenas se pasa y se cancela el resto.
 *
 * Es de `lib/` y no importa nada del servidor: la usan las rutas de `app/api/**`.
 */
export type LimitedBody = { ok: true; text: string } | { ok: false; reason: "too_large" };

/** Un carácter ocupa hasta 4 bytes en UTF-8: con esto el tope en caracteres de cada ruta sigue mandando. */
export const bodyBytesForChars = (chars: number): number => chars * 4;

/**
 * Para handlers de terceros que leen el `Request` ellos mismos (el servidor MCP): lee el cuerpo con tope
 * y devuelve un `Request` nuevo con el cuerpo ya leído, o `too_large` si pasa el tope. Sin cuerpo
 * (GET, DELETE) devuelve el mismo pedido.
 */
export async function limitedRequest(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; request: Request } | { ok: false; reason: "too_large" }> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "DELETE") {
    return { ok: true, request };
  }
  const body = await readBodyLimited(request, maxBytes);
  if (!body.ok) return body;
  const headers = new Headers(request.headers);
  // El largo declarado ya no es el del cuerpo reconstruido
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return {
    ok: true,
    request: new Request(request.url, { method: request.method, headers, body: body.text }),
  };
}

export async function readBodyLimited(request: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = request.headers.get("content-length");
  // Solo dígitos: "1e3", "-1" o texto no se interpretan; en ese caso manda el cuerpo real
  if (declared !== null && /^\d{1,15}$/.test(declared.trim()) && Number(declared) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

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
  return { ok: true, text: new TextDecoder().decode(all) };
}
