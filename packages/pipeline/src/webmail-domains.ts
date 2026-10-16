/**
 * Proveedores de correo personal (RM-3, ronda 58). Un dominio de esta lista nunca puede ser una
 * fuente de empleo: marcarlo haría que el webhook guarde completo el correo de cualquier persona
 * con una cuenta ahí (privacidad). Puro: sin I/O.
 */

/** Dominios base, sin acentos. Las variantes de país de las marcas grandes las cubre `BRAND_COUNTRY`. */
export const WEBMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "yandex.ru",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "hey.com",
] as const;

const LIST = new Set<string>(WEBMAIL_DOMAINS);

/**
 * Variantes de país: `yahoo.com.ar`, `hotmail.es`, `outlook.com.br`, `live.com.mx`.
 * Decisión: `baseDomain` ya devuelve `yahoo.com.ar` (no `com.ar`), pero su lista de segundos
 * niveles es corta y acá no se quiere depender de eso. Se prueban los sufijos de 2 y 3 etiquetas
 * del host contra la lista exacta y contra una regex por marca: marca + (com./co./org./net.)? +
 * código de país de 2 letras. Se acepta alguna sobre-cobertura (`live.it`): bloquear de más es
 * seguro; dejar pasar uno, no.
 */
const BRAND_COUNTRY =
  /^(?:yahoo|hotmail|outlook|live|gmail|googlemail|msn|icloud|aol|gmx|yandex)\.(?:(?:com?|org|net)\.)?[a-z]{2}$/;

/** ¿El host o dominio es de un proveedor de correo personal? Insensible a mayúsculas y subdominios. */
export function isWebmailDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  // Se prueban los sufijos de 2 y 3 etiquetas (`yahoo.com`, `yahoo.com.ar`) contra la lista y la
  // regex; así un subdominio (`mail.yahoo.com.ar`) cae igual y `gmail.com.empresa-a.example` no.
  const labels = host.split(".");
  for (const n of [2, 3]) {
    if (labels.length < n) break;
    const suffix = labels.slice(-n).join(".");
    if (LIST.has(suffix) || BRAND_COUNTRY.test(suffix)) return true;
  }
  return false;
}
