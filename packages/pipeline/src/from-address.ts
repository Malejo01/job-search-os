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

/** Modo de `INBOUND_DMARC_MODE`. Vacío o desconocido es `log`: mide sin frenar emails reales. */
export function parseInboundDmarcMode(raw: string | undefined): InboundDmarcMode {
  const mode = raw?.trim().toLowerCase();
  return mode === "off" || mode === "enforce" ? mode : "log";
}

function headerValues(headers: Record<string, unknown>, wanted: string): string[] {
  return Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === wanted)
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .map(String);
}

/**
 * Veredicto de autenticación según los encabezados del email. Un `fail` gana sobre cualquier `pass`. Sin
 * resultado de DMARC se usa DKIM y después SPF. Una firma `DKIM-Signature` sola no prueba nada: nadie la verificó.
 */
export function authResultsVerdict(
  headers: Record<string, unknown> | null | undefined,
): AuthVerdict {
  if (!headers) return "none";
  const results = headerValues(headers, "authentication-results");
  if (results.some((v) => /\bdmarc\s*=\s*fail\b/i.test(v))) return "fail";
  if (results.some((v) => /\bdmarc\s*=\s*pass\b/i.test(v))) return "aligned";
  if (results.some((v) => /\bdkim\s*=\s*pass\b/i.test(v))) return "aligned";
  const spf = headerValues(headers, "received-spf");
  if (spf.some((v) => /^\s*fail\b/i.test(v))) return "fail";
  if (spf.some((v) => /^\s*pass\b/i.test(v))) return "aligned";
  return "none";
}
