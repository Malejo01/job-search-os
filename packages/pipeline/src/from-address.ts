import { readMode } from "./env-modes";

// Los lectores de variables salen también por este archivo, que el índice del paquete ya exporta
export * from "./env-modes";

/**
 * Lectura del encabezado From. La dirección es la que queda fuera de las comillas y de los comentarios: lo
 * que diga el nombre visible no cuenta. Falla cerrado: lo ambiguo o mal formado devuelve `null`.
 */
const MAX_FROM_LENGTH = 2_000;
const ADDRESS = /^[^\s@<>,;:()"]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** Dirección del remitente en minúsculas, o `null` si no hay exactamente una dirección legible. */
export function parseFromAddress(from: string): string | null {
  if (from.length > MAX_FROM_LENGTH) return null;

  const outside: string[] = [];
  let inQuotes = false;
  let commentDepth = 0;
  for (let i = 0; i < from.length; i += 1) {
    const c = from[i]!;
    if (inQuotes) {
      if (c === "\\") i += 1;
      else if (c === '"') inQuotes = false;
    } else if (commentDepth > 0) {
      if (c === "\\") i += 1;
      else if (c === "(") commentDepth += 1;
      else if (c === ")") commentDepth -= 1;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === "(") {
      commentDepth = 1;
    } else if (c === ")") {
      return null;
    } else {
      outside.push(c);
    }
  }
  if (inQuotes || commentDepth > 0) return null;

  const text = outside.join("");
  const opens = text.split("<").length - 1;
  const closes = text.split(">").length - 1;
  if (opens !== closes || opens > 1) return null;

  let address = text;
  if (opens === 1) {
    const angle = /<([^<>]*)>\s*$/.exec(text);
    if (!angle) return null;
    address = angle[1]!;
  }
  address = address.trim().toLowerCase();
  return ADDRESS.test(address) ? address : null;
}

export type AuthVerdict = "aligned" | "fail" | "none";

/** `off`: no se mira. `log`: se registra sin cambiar nada. `enforce`: sin `aligned` no se procesa. */
export type InboundDmarcMode = "off" | "log" | "enforce";

export const INBOUND_DMARC_MODES = ["off", "log", "enforce"] as const;

/**
 * Modo de `INBOUND_DMARC_MODE`. Vacío o desconocido es `log`: mide sin frenar emails reales. Quien necesite
 * el aviso de un valor desconocido usa `readMode` directamente (el log lo hace el adapter).
 */
export function parseInboundDmarcMode(raw: string | undefined): InboundDmarcMode {
  return readMode("INBOUND_DMARC_MODE", raw, INBOUND_DMARC_MODES, "log").value;
}

/** Un `Authentication-Results` real mide una fracción de esto; más largo no se lee. */
const MAX_AUTH_RESULTS_CHARS = 8 * 1024;

/** Primera instancia del encabezado, o `null`. Solo mira el primer valor: lo demás no se recorre. */
function firstHeaderValue(headers: Record<string, unknown>, wanted: string): string | null {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== wanted) continue;
    const value = headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first : null;
  }
  return null;
}

/**
 * Veredicto de autenticación según el `Authentication-Results` que agregó el receptor propio. Cuenta solo la
 * **primera** instancia (la que se antepone al llegar) y solo si empieza con el authserv-id configurado
 * (`INBOUND_AUTHSERV_ID`): lo que escribe quien envía no es una prueba. `aligned` exige `dmarc=pass` con
 * `header.from` igual al dominio del From. DKIM y SPF sueltos no cuentan. Sin authserv-id configurado, sin
 * encabezado o con un From ilegible, el veredicto es `none` (en `enforce`, el email se retiene).
 */
export function authResultsVerdict(
  headers: Record<string, unknown> | null | undefined,
  authservId: string | null | undefined,
  from: string,
): AuthVerdict {
  const expectedId = authservId?.trim().toLowerCase();
  if (!headers || !expectedId) return "none";
  const value = firstHeaderValue(headers, "authentication-results");
  if (value === null || value.length > MAX_AUTH_RESULTS_CHARS) return "none";

  const [head = "", ...results] = value.split(";");
  if (head.trim().split(/\s+/, 1)[0]?.toLowerCase() !== expectedId) return "none";
  const address = parseFromAddress(from);
  if (!address) return "none";
  const fromDomain = address.slice(address.lastIndexOf("@") + 1);

  for (const result of results) {
    const dmarc = /^\s*dmarc\s*=\s*([a-z]+)/i.exec(result)?.[1]?.toLowerCase();
    if (!dmarc) continue;
    if (dmarc === "fail") return "fail";
    if (dmarc !== "pass") return "none";
    const headerFrom = /\bheader\.from\s*=\s*"?([^\s;"()]+)/i.exec(result)?.[1]?.toLowerCase();
    return headerFrom === fromDomain ? "aligned" : headerFrom ? "fail" : "none";
  }
  return "none";
}
