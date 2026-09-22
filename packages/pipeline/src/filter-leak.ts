/**
 * Posible fuga del filtro de reenvío (JS-048). Un filtro de Gmail mal configurado se nota
 * primero por QUIÉN manda, no por cuánto llega: el 2026-09-18..21 entraron banco, streaming,
 * cursos y GitHub con un volumen tan bajo que el aviso de volumen (JS-038) nunca saltó.
 *
 * Regla: avisa por cada dominio cuyo PRIMER email es de las últimas `windowHours` (48 h), que no
 * es una fuente de empleo esperada y que la persona todavía no marcó. Un solo email alcanza.
 * Puro: recibe los remitentes agrupados por host y devuelve los dominios sospechosos.
 */

/**
 * Fuentes de empleo esperadas: las que tienen parser (con todos sus remitentes, también los
 * sociales de LinkedIn, JS-050) e Indeed, que está en el filtro de Gmail aunque todavía no tenga
 * parser (JS-047). No avisan como fuga (JS-048) y se guardan completas (JS-051).
 */
export const EXPECTED_SOURCE_DOMAINS = [
  "linkedin.com",
  "getonbrd.com",
  "getonboard.com",
  "indeed.com",
] as const;

/** Segundos niveles de país: `mails.banco.com.ar` → `banco.com.ar`, no `com.ar`. */
const SECOND_LEVEL = new Set(["com", "net", "org", "gob", "gov", "edu", "co", "ac", "mil"]);

/** Dominio base de un host, sin lista de sufijos públicos: alcanza para agrupar remitentes. */
export function baseDomain(host: string): string {
  const labels = host.trim().toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const [sld, tld] = labels.slice(-2);
  const keep = tld!.length === 2 && SECOND_LEVEL.has(sld!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** Host del remitente: "Banco <a@mails.banco.com.ar>" → "mails.banco.com.ar"; "" si no hay arroba. */
export function senderHost(fromAddress: string): string {
  const addr = (/<([^>]+)>/.exec(fromAddress)?.[1] ?? fromAddress).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  return at < 0 ? "" : addr.slice(at + 1).replace(/[>\s]+$/, "");
}

/**
 * Remitente esperado (JS-051): una fuente de empleo conocida o un dominio que la persona marcó
 * como fuente de empleo. Solo de estos el webhook guarda el email completo; del resto, solo
 * remitente, asunto y fecha.
 */
export function isExpectedSender(fromAddress: string, userJobDomains: readonly string[]): boolean {
  const host = senderHost(fromAddress);
  if (!host) return false;
  const domain = baseDomain(host);
  return (
    (EXPECTED_SOURCE_DOMAINS as readonly string[]).includes(domain) ||
    userJobDomains.includes(domain)
  );
}

export type SenderCategory = "banco" | "streaming" | "e-commerce";

/**
 * Etiqueta orientativa, por una lista corta y explícita: solo para que se note la gravedad. Lo
 * que no está en la lista queda sin categoría; nunca se lee el contenido del email. Se compara
 * el comienzo del nombre del dominio (`bancoejemplo`, `amazonses`), no cualquier parte.
 */
const CATEGORY_KEYWORDS: Record<SenderCategory, readonly string[]> = {
  banco: [
    "banco",
    "bank",
    "santander",
    "galicia",
    "bbva",
    "bancomacro",
    "hsbc",
    "icbc",
    "brubank",
    "uala",
    "naranjax",
    "mercadopago",
    "supervielle",
    "itau",
    "paypal",
    "payoneer",
  ],
  streaming: [
    "netflix",
    "spotify",
    "disneyplus",
    "disney",
    "hbomax",
    "warnerbros",
    "primevideo",
    "youtube",
    "twitch",
    "crunchyroll",
    "paramountplus",
    "starplus",
  ],
  "e-commerce": [
    "mercadolibre",
    "amazon",
    "aliexpress",
    "temu",
    "shein",
    "ebay",
    "tiendanube",
    "viagogo",
    "despegar",
    "rappi",
    "pedidosya",
  ],
};

export function senderCategory(domain: string): SenderCategory | null {
  const name = baseDomain(domain).split(".")[0] ?? "";
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS) as [
    SenderCategory,
    readonly string[],
  ][]) {
    // Solo por el comienzo del nombre: por el final, "stackoverflow" caería en "flow"
    if (words.some((w) => name.startsWith(w))) return category;
  }
  return null;
}

export type SenderHost = {
  /** Host del remitente, en minúsculas: `mails.banco.com.ar`. */
  host: string;
  /** Primer email de este host (de todos los tiempos que quedan en la base). */
  firstAt: Date;
  lastAt: Date;
  /** Emails de este host dentro de la ventana. */
  recent: number;
};

export type FilterLeak = {
  domain: string;
  category: SenderCategory | null;
  /** Emails del dominio dentro de la ventana. */
  recent: number;
  firstAt: Date;
  hosts: string[];
};

export type FilterLeakInput = {
  now: Date;
  hosts: readonly SenderHost[];
  /** Dominios que la persona ya marcó: "empleo" (fuente esperada) o "no_empleo" (ya lo vio). */
  userVerdicts: Readonly<Record<string, "empleo" | "no_empleo">>;
  windowHours?: number;
};

export function detectFilterLeaks(input: FilterLeakInput): FilterLeak[] {
  const since = input.now.getTime() - (input.windowHours ?? 48) * 3_600_000;
  const expected = new Set<string>(EXPECTED_SOURCE_DOMAINS);

  const byDomain = new Map<string, SenderHost[]>();
  for (const h of input.hosts) {
    const d = baseDomain(h.host);
    byDomain.set(d, [...(byDomain.get(d) ?? []), h]);
  }

  const leaks: FilterLeak[] = [];
  for (const [domain, hosts] of byDomain) {
    if (expected.has(domain) || input.userVerdicts[domain]) continue;
    const firstAt = new Date(Math.min(...hosts.map((h) => h.firstAt.getTime())));
    const recent = hosts.reduce((n, h) => n + h.recent, 0);
    if (firstAt.getTime() < since || recent === 0) continue;
    leaks.push({
      domain,
      category: senderCategory(domain),
      recent,
      firstAt,
      hosts: hosts.map((h) => h.host).sort(),
    });
  }
  return leaks.sort(
    (a, b) =>
      Number(b.category !== null) - Number(a.category !== null) ||
      b.recent - a.recent ||
      a.domain.localeCompare(b.domain),
  );
}
