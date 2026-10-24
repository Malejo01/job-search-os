/**
 * Validación de la URL del alta manual. Pura: solo mira el texto, no resuelve DNS ni abre la
 * URL (D-028). Rechaza esquemas que no sean http(s), credenciales embebidas y hosts internos.
 * No alcanza contra SSRF: un dominio público puede resolver a una IP interna. Si algún día el
 * servidor abre estas URLs, hay que resolver el DNS y revalidar la IP antes de cada request.
 */

export type ManualUrlResult = { ok: true; url: string | null } | { ok: false };

const MAX_LENGTH = 2000;
const INTERNAL_TLDS = ["local", "internal", "lan", "home", "corp", "intranet"];

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function isBlockedIpv4([a, b, c]: number[]): boolean {
  if (a === undefined || b === undefined || c === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    // Reservadas y de documentación: 192.0.0/24, 192.0.2/24, 192.88.99/24, 198.51.100/24, 203.0.113/24
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** IPv4 de dos grupos de 16 bits de un IPv6. */
function embeddedIpv4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

/** Expande un IPv6 ya normalizado por URL (sin corchetes) a 8 grupos, o null si no se entiende. */
function ipv6Groups(host: string): number[] | null {
  const parts = host.split("::");
  if (parts.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(parts[0] ?? "");
  const tail = parts.length === 2 ? toGroups(parts[1] ?? "") : [];
  if (!head || !tail) return null;
  if (parts.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function isBlockedIpv6(host: string): boolean {
  const g = ipv6Groups(host);
  if (!g) return true; // no se entiende: se rechaza
  const first = g[0] ?? 0;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentación
  if (first === 0x2001 && g[1] === 0) return true; // Teredo (2001::/32): lleva una IPv4 ofuscada
  if (first === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // NAT64 local (64:ff9b:1::/48)
  // ::ffff:a.b.c.d (mapeada) y ::a.b.c.d (compatible): se juzga la IPv4 embebida
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isBlockedIpv4(embeddedIpv4(g[6] ?? 0, g[7] ?? 0));
  }
  // NAT64 (64:ff9b::/96) y 6to4 (2002::/16) también: se juzga la IPv4 que llevan
  if (first === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIpv4(embeddedIpv4(g[6] ?? 0, g[7] ?? 0));
  }
  if (first === 0x2002) return isBlockedIpv4(embeddedIpv4(g[1] ?? 0, g[2] ?? 0));
  return false;
}

function isBlockedHost(rawHost: string): boolean {
  if (rawHost.startsWith("[") && rawHost.endsWith("]")) {
    return isBlockedIpv6(rawHost.slice(1, -1));
  }
  const host = rawHost.replace(/\.$/, "").toLowerCase();
  if (host === "") return true;
  const octets = ipv4Octets(host);
  if (octets) return isBlockedIpv4(octets);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (!host.includes(".")) return true; // una sola etiqueta
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (INTERNAL_TLDS.includes(tld)) return true;
  // Un último segmento numérico no es un TLD real: forma rara de IP que no se normalizó
  if (/^\d+$/.test(tld) || /^0x[0-9a-f]*$/i.test(tld)) return true;
  return false;
}

export function parseManualUrl(raw: string): ManualUrlResult {
  const text = raw.trim();
  if (text === "") return { ok: true, url: null };
  if (text.length > MAX_LENGTH) return { ok: false };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false };
  if (u.username !== "" || u.password !== "") return { ok: false };
  if (isBlockedHost(u.hostname)) return { ok: false };
  return { ok: true, url: u.href };
}

// re-export del alta manual; pasa a index.ts después del #92
export * from "./manual-paste";
