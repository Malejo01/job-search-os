import { createHash } from "node:crypto";
import { norm, scanLine, scanText } from "../../../../scripts/privacy-scan.mjs";
import type { Hit, Pattern } from "../../../../scripts/privacy-scan.mjs";

/**
 * Esqueleto de un .eml sin datos personales (R8-1a). Lógica pura: recibe el contenido y los
 * patrones de privacidad, devuelve texto. El I/O vive en skeleton-cli.ts.
 *
 * Qué conserva: la estructura del HTML (etiquetas, class, style, width, align, role, colspan...),
 * los nombres de los parámetros de las URL y el texto de plantilla (idéntico en al menos 2 emails
 * de la carpeta, sin dígitos ni «@», sin coincidir con ningún patrón de privacidad).
 * Qué enmascara por forma: todo lo demás (letras → x/X, dígitos → 9; puntuación y espacios iguales).
 * Qué saca: comentarios, <script>, cabeceras del mail.
 *
 * Nombres: el texto que sigue a un saludo nunca se conserva (lista en GREETING_WORDS), pero esa lista es
 * una ayuda, no la garantía: la defensa principal contra un nombre filtrado es el barrido de patrones de
 * privacidad sobre toda la salida. Revisar el resultado antes de compartirlo.
 *
 * Falla cerrado: sin patrones no se emite nada; HTML mal formado, MIME ilegible o cualquier
 * patrón que coincida en la salida dejan al email afuera (solo se informa el número de patrón).
 */

// ---------------------------------------------------------------------------------------------
// Enmascarado por forma
// ---------------------------------------------------------------------------------------------

/** Letras → x/X (respetando mayúsculas), dígitos → 9; el resto (puntuación, espacios) igual. */
export function maskShape(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    if (/\p{Lu}/u.test(ch)) out += "X";
    else if (/\p{L}/u.test(ch)) out += "x";
    else if (/\p{N}/u.test(ch)) out += "9";
    else if (/\p{M}/u.test(ch)) continue;
    else out += ch;
  }
  return out;
}

/** Entidades sin datos (espacio, signos): se dejan. Cualquier otra con nombre se trata como letra. */
const KEEP_ENTITIES = new Set([
  "nbsp",
  "amp",
  "lt",
  "gt",
  "quot",
  "apos",
  "middot",
  "bull",
  "ndash",
  "mdash",
  "hellip",
  "laquo",
  "raquo",
  "copy",
  "reg",
  "trade",
  "zwnj",
  "zwj",
]);
const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

/** Enmascara texto o valor de atributo que puede traer entidades HTML. Ante la duda, enmascara. */
export function maskHtmlText(s: string): string {
  let out = "";
  let last = 0;
  for (const m of s.matchAll(ENTITY_RE)) {
    out += maskShape(s.slice(last, m.index));
    last = m.index + m[0].length;
    const body = m[1]!;
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      let ch: string;
      try {
        ch = String.fromCodePoint(code);
      } catch {
        ch = "a";
      }
      out += /[\p{L}\p{N}]/u.test(ch) ? maskShape(ch) : m[0];
    } else {
      out += KEEP_ENTITIES.has(body.toLowerCase()) ? m[0] : "x";
    }
  }
  out += maskShape(s.slice(last));
  return out;
}

/** Texto ya enmascarado, listo para ir dentro de un nodo de texto. */
function escapeText(s: string): string {
  return s.replace(/</g, "&lt;");
}

// ---------------------------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------------------------

const KEEP_SCHEMES = new Set(["http", "https", "mailto", "tel", "cid"]);

/** Qué hosts salen en claro. Vacío = ninguno (todo host se enmascara salvo el TLD). */
export type HostContext = { clearHosts: readonly string[] };
const NO_HOSTS: HostContext = { clearHosts: [] };

/**
 * Infraestructura de terceros conocida (CDN, tracking, redes, estándares). Se conserva el dominio,
 * pero no lo que haya a la izquierda: `empresa.s3.amazonaws.com` no puede salir con la empresa.
 */
const KNOWN_HOSTS = [
  "w3.org",
  "schema.org",
  "googleapis.com",
  "gstatic.com",
  "google.com",
  "google-analytics.com",
  "doubleclick.net",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "apple.com",
  "sendgrid.net",
  "mailchimp.com",
  "list-manage.com",
  "mcusercontent.com",
  "mandrillapp.com",
  "mailgun.org",
  "sparkpostmail.com",
  "amazonses.com",
  "amazonaws.com",
  "cloudfront.net",
  "cloudinary.com",
  "hubspot.com",
  "braze.com",
  "customer.io",
  "mlsend.com",
];

const hostMatches = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/**
 * Host del portal (--portal): en claro, salvo labels largos con dígitos (ids de cuenta, tokens).
 * Infraestructura conocida: solo el dominio. Cualquier otro: labels enmascarados y el TLD en claro
 * (un `logos.<empresa>.com` no puede salir).
 */
export function maskHost(host: string, ctx: HostContext = NO_HOSTS): string {
  const h = host.toLowerCase();
  if (ctx.clearHosts.some((d) => hostMatches(h, d))) {
    return h
      .split(".")
      .map((l) => (/\d/.test(l) && l.length > 4 ? maskShape(l) : l))
      .join(".");
  }
  const known = KNOWN_HOSTS.find((d) => hostMatches(h, d));
  if (known) return `${maskShape(h.slice(0, h.length - known.length))}${known}`;
  const labels = h.split(".");
  const tld = labels.pop() ?? "";
  if (labels.length === 0 || !/^[a-z]{2,24}$/.test(tld)) return maskShape(h);
  return [...labels.map((l) => maskShape(l)), tld].join(".");
}

/** Nombre de parámetro de query: solo si parece un identificador corto sin ids adentro. */
function safeParamName(name: string): boolean {
  return /^[A-Za-z_][\w.[\]-]{0,40}$/.test(name) && !/\d{3,}/.test(name);
}

function maskQuery(query: string): string {
  return query
    .split(/&amp;|&/)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const name = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : null;
      const n = safeParamName(name) ? name : maskHtmlText(name);
      return value === null ? n : `${n}=${maskHtmlText(value)}`;
    })
    .join("&amp;");
}

/** href/src: esquema + host + ruta enmascarada; nombres de parámetros sí, valores no. */
export function maskUrl(raw: string, ctx: HostContext = NO_HOSTS): string {
  const v = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v)?.[1]?.toLowerCase() ?? null;
  if (scheme && !KEEP_SCHEMES.has(scheme)) return maskHtmlText(v);
  if (scheme === "mailto" || scheme === "tel" || scheme === "cid") {
    return `${scheme}:${maskHtmlText(v.slice(scheme.length + 1))}`;
  }
  const m = /^(?:([a-z][a-z0-9+.-]*):)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/i.exec(v);
  if (!m) return maskHtmlText(v);
  const [, sch, authority, path = "", query, fragment] = m;
  let out = "";
  if (sch) out += `${sch.toLowerCase()}:`;
  if (authority) {
    const auth = authority.slice(2);
    // Con usuario o con algo que no es un host, se enmascara todo
    out += /^[a-z0-9.-]+(:\d+)?$/i.test(auth)
      ? `//${maskHost(auth.replace(/:\d+$/, ""), ctx)}${/:\d+$/.test(auth) ? ":9999" : ""}`
      : `//${maskHtmlText(auth)}`;
  }
  out += maskHtmlText(path);
  if (query) out += `?${maskQuery(query.slice(1))}`;
  if (fragment) out += `#${maskHtmlText(fragment.slice(1))}`;
  return out;
}

/** Host de una URL absoluta, en minúsculas; null si no la tiene. */
function hostOf(raw: string): string | null {
  const m = /^(?:https?:)?\/\/([^/?#:@]+)/i.exec(raw.trim());
  return m?.[1]?.toLowerCase() ?? null;
}

// ---------------------------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------------------------

/** CSS sin comentarios, con url() y cadenas entre comillas enmascaradas por forma. */
export function sanitizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\(\s*([^)]*?)\s*\)/gi, (_m, inner: string) => `url(${maskShape(inner)})`)
    .replace(
      /(["'])((?:(?!\1)[^\\\r\n])*)\1/g,
      (_m, q: string, inner: string) => `${q}${maskShape(inner)}${q}`,
    )
    .replace(/@import[^;]*;/gi, "@import xxx;");
}

// ---------------------------------------------------------------------------------------------
// Tokenizador de HTML (a mano: sin dependencias)
// ---------------------------------------------------------------------------------------------

type Attr = { name: string; value: string | null };
type Token =
  | { kind: "text"; raw: string }
  | { kind: "tag"; name: string; closing: boolean; selfClosing: boolean; attrs: Attr[] }
  | { kind: "style"; css: string };

type TokenizeFlags = { jsonLd: boolean; jsonLdTypes: string[]; microdata: boolean };
type Tokenized =
  { ok: true; tokens: Token[]; flags: TokenizeFlags } | { ok: false; reason: string };

/** Tag que abre en `i` (donde hay un «<»): hasta el «>» que cierra, respetando comillas. */
function parseTag(
  html: string,
  i: number,
): { end: number; name: string; closing: boolean; selfClosing: boolean; attrs: Attr[] } | null {
  const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(i, i + 80));
  if (!head) return null;
  const closing = head[1] === "/";
  const name = head[2]!.toLowerCase();
  let p = i + head[0].length;
  const attrs: Attr[] = [];
  let selfClosing = false;
  for (;;) {
    while (p < html.length && /[\s/]/.test(html[p]!)) {
      if (html[p] === "/" && /^\/\s*>/.test(html.slice(p, p + 8))) selfClosing = true;
      p++;
    }
    if (p >= html.length) return null;
    if (html[p] === ">") return { end: p + 1, name, closing, selfClosing, attrs };
    const nm = /^[^\s=>/]+/.exec(html.slice(p, p + 200));
    if (!nm) return null;
    p += nm[0].length;
    while (p < html.length && /\s/.test(html[p]!)) p++;
    if (html[p] !== "=") {
      attrs.push({ name: nm[0], value: null });
      continue;
    }
    p++;
    while (p < html.length && /\s/.test(html[p]!)) p++;
    if (p >= html.length) return null;
    const q = html[p]!;
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, p + 1);
      if (close < 0) return null;
      attrs.push({ name: nm[0], value: html.slice(p + 1, close) });
      p = close + 1;
    } else {
      const um = /^[^\s>]*/.exec(html.slice(p))!;
      attrs.push({ name: nm[0], value: um[0] });
      p += um[0].length;
    }
  }
}

function tokenize(html: string): Tokenized {
  const tokens: Token[] = [];
  const flags: TokenizeFlags = { jsonLd: false, jsonLdTypes: [], microdata: false };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      tokens.push({ kind: "text", raw: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ kind: "text", raw: html.slice(i, lt) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end < 0) return { ok: false, reason: "comentario HTML sin cerrar" };
      i = end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      if (end < 0) return { ok: false, reason: "declaración HTML sin cerrar" };
      i = end + 1;
      continue;
    }
    if (!/[a-zA-Z/]/.test(html[lt + 1] ?? "")) {
      tokens.push({ kind: "text", raw: "<" });
      i = lt + 1;
      continue;
    }
    const tag = parseTag(html, lt);
    if (!tag) return { ok: false, reason: "etiqueta HTML mal formada o sin cerrar" };
    for (const a of tag.attrs) {
      const n = a.name.toLowerCase();
      if (n === "itemscope" || n === "itemtype") flags.microdata = true;
    }
    i = tag.end;
    if (!tag.closing && (tag.name === "script" || tag.name === "style")) {
      const closeRe = new RegExp(`</${tag.name}\\s*>`, "i");
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      if (!m) return { ok: false, reason: `<${tag.name}> sin cerrar` };
      const content = rest.slice(0, m.index);
      if (tag.name === "script") {
        const type = tag.attrs.find((a) => a.name.toLowerCase() === "type")?.value ?? "";
        if (/ld\+json/i.test(type)) {
          flags.jsonLd = true;
          for (const t of content.matchAll(/"@type"\s*:\s*"([A-Za-z]{1,40})"/g)) {
            if (!flags.jsonLdTypes.includes(t[1]!)) flags.jsonLdTypes.push(t[1]!);
          }
        }
        // El script entero queda afuera
      } else {
        tokens.push({ ...tag, kind: "tag" });
        tokens.push({ kind: "style", css: content });
        tokens.push({ kind: "tag", name: "style", closing: true, selfClosing: false, attrs: [] });
      }
      i += m.index + m[0].length;
      continue;
    }
    tokens.push({ ...tag, kind: "tag" });
  }
  return { ok: true, tokens, flags };
}

// ---------------------------------------------------------------------------------------------
// Atributos
// ---------------------------------------------------------------------------------------------

/** Atributos estructurales: valor verbatim si tiene solo caracteres de «forma». */
const STRUCTURAL_ATTRS = new Set([
  "class",
  "id",
  "style",
  "charset",
  "width",
  "height",
  "align",
  "valign",
  "role",
  "colspan",
  "rowspan",
  "cellpadding",
  "cellspacing",
  "border",
  "bgcolor",
  "color",
  "dir",
  "lang",
  "target",
  "rel",
  "type",
]);
const URL_ATTRS = new Set(["href", "src", "background", "action", "poster", "cite", "formaction"]);
const SAFE_VALUE_RE = /^[\w\s.%#:;,()!/+-]{0,200}$/;

/**
 * Vocabulario estructural de class/id: layout, componentes y semántica de un aviso (lo que un
 * parser necesita para ubicar un bloque). Un token se conserva solo si TODAS sus partes (separadas
 * por «-», «_» o camelCase) están acá, son un número de hasta 3 dígitos o tienen 1 o 2 letras.
 * Cualquier otro (un nombre de empresa, un id, un hash) se enmascara por forma.
 */
const CLASS_VOCAB = new Set(
  (
    "container wrapper wrap main outer inner row col cols column columns grid table tbl td tr th cell box " +
    "card block section content body header footer head foot pie cabecera hero banner logo img image icon " +
    "btn button boton link a title titulo text texto desc description descripcion item items list lista " +
    "job jobs aviso avisos empleo empleos oferta ofertas puesto vacante company empresa location ubicacion " +
    "lugar salary salario sueldo date fecha time modality modalidad type tipo category categoria apply " +
    "postular ver more mas new nuevo badge tag label name nombre meta info detail details data hidden " +
    "show hide mobile desktop tablet outlook mso ms externalclass yshortcuts email mail preheader preview " +
    "unsubscribe social center left right top bottom middle full half third small large sm md lg xl xs " +
    "width fluid stack padding margin spacer divider separator line border bg color white black gray grey " +
    "primary secondary bold normal font size footer-text remote remoto presencial hibrido result results " +
    "resultado resultados alert alerta search busqueda contenedor saludo external class"
  ).split(" "),
);

function structuralToken(token: string): boolean {
  const parts = token.split(/[-_]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every(
      (p) => /^\d{1,3}$/.test(p) || /^[A-Za-z]{1,2}$/.test(p) || CLASS_VOCAB.has(p.toLowerCase()),
    )
  );
}

/** class/id: los tokens del vocabulario van en claro; los demás, por forma. */
function renderStructuralNames(value: string): string {
  return value
    .split(/(\s+)/)
    .map((t) => (!t.trim() || structuralToken(t) ? t : maskShape(t)))
    .join("");
}

function renderAttrValue(name: string, value: string, ctx: HostContext): string {
  if (URL_ATTRS.has(name)) return maskUrl(value, ctx);
  if (name === "style") return sanitizeCss(value);
  if (STRUCTURAL_ATTRS.has(name)) {
    if (!SAFE_VALUE_RE.test(value)) return maskHtmlText(value);
    return name === "class" || name === "id" ? renderStructuralNames(value) : value;
  }
  // alt, title, value, data-*, aria-*, content, name, srcset... enmascarados igual que el texto
  return maskHtmlText(value);
}

function renderAttr(a: Attr, ctx: HostContext): string {
  let name = a.name.toLowerCase();
  const nameOk = /^[a-z_:][a-z0-9_:.-]*$/.test(name) && !/\d{3,}/.test(name);
  if (!nameOk) name = maskShape(name).replace(/[^a-zA-Z0-9_:.-]/g, "x");
  if (a.value === null) return name;
  return `${name}="${renderAttrValue(name, a.value, ctx).replace(/"/g, "&quot;")}"`;
}

// ---------------------------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------------------------

/**
 * Saludos y fórmulas de bienvenida en español, inglés, francés, portugués e italiano (S-9). La defensa
 * principal contra un nombre filtrado NO es esta lista (siempre habrá un saludo que no figure): es el
 * barrido de patrones de privacidad que corre sobre toda la salida y bloquea el email si coincide.
 * Esto solo evita que un nombre repetido en 2 emails pase por «texto de plantilla».
 */
const GREETING_WORDS =
  "hola|hello|hi(?:\\s+there)?|hey|buen[oa]s(?:\\s+(?:d[ií]as|tardes|noches))?|buen\\s+d[ií]a|estimad[oa](?:\\/a)?s?|querid[oa](?:\\/a)?s?|dear|good\\s+(?:morning|afternoon|evening)|welcome(?:\\s+back)?|bienvenid[oa](?:\\/a)?s?|saludos|bonjour|bonsoir|ol[áa]|ciao";

/** Un texto que ARRANCA con un saludo (con o sin signos de apertura): nunca es plantilla. */
const GREETING_RE = new RegExp(`^[¡¿"'(\\s]*(?:${GREETING_WORDS}|buen\\s+d[ií]a)`, "i");

/**
 * Un texto que TERMINA en un saludo («Hola», «Hola,», «Estimado/a», «Querido/a», «Buen día»): lo que
 * viene después es el nombre de la persona, aunque esté en otro nodo de texto (`Hola <b>Nombre</b>`).
 */
const GREETING_END_RE = new RegExp(`(?:^|[\\s¡¿"'(])(?:${GREETING_WORDS})[\\s,:;.!-]*$`, "i");

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  iacute: "í",
  aacute: "á",
  eacute: "é",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  agrave: "à",
  egrave: "è",
  ocirc: "ô",
  atilde: "ã",
  quot: '"',
  apos: "'",
};

/** Texto con las entidades de espacio y de letra más comunes decodificadas, solo para reconocer saludos. */
function decodeForGreeting(raw: string): string {
  return raw.replace(ENTITY_RE, (m: string, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      try {
        const ch = String.fromCodePoint(code);
        return /\s/u.test(ch) ? " " : ch;
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Textos que vienen justo después de un saludo (el siguiente nodo de texto con contenido). Nunca se
 * conservan: un nombre repetido en dos emails no es plantilla. El saludo se busca con las entidades
 * decodificadas (`Hola&nbsp;<b>Nombre</b>`, `&#32;`, `&#160;`); la clave que se guarda es la del texto crudo.
 */
function greetingFollowers(tokens: Token[]): Set<string> {
  const out = new Set<string>();
  let afterGreeting = false;
  for (const t of tokens) {
    if (t.kind !== "text") continue;
    const key = textKey(t.raw);
    const plain = textKey(decodeForGreeting(t.raw));
    // Solo signos o espacios (también como entidad) entre el saludo y el nombre: sigue esperando el nombre
    if (!plain || /^[\s,:;.!¡¿-]+$/.test(plain)) continue;
    if (afterGreeting) out.add(key);
    afterGreeting = GREETING_END_RE.test(plain);
  }
  return out;
}

/** Texto sin espacios de más: la clave para comparar plantillas entre emails. */
function textKey(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function render(tokens: Token[], keep: ReadonlySet<string>, ctx: HostContext): string {
  let out = "";
  for (const t of tokens) {
    if (t.kind === "text") {
      const key = textKey(t.raw);
      if (!key) out += t.raw;
      else out += keep.has(key) ? t.raw : escapeText(maskHtmlText(t.raw));
    } else if (t.kind === "style") {
      out += sanitizeCss(t.css);
    } else if (t.closing) {
      out += `</${t.name}>`;
    } else {
      const attrs = t.attrs.map((a) => renderAttr(a, ctx));
      out += `<${[t.name, ...attrs].join(" ")}${t.selfClosing ? " /" : ""}>`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Bloques repetidos
// ---------------------------------------------------------------------------------------------

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

type TreeNode = {
  tag: string;
  cls: string;
  kids: TreeNode[];
  portalLinks: number;
  sig: string;
  size: number;
};

function buildTree(tokens: Token[], isPortal: (href: string) => boolean): TreeNode[] {
  const root: TreeNode = { tag: "#root", cls: "", kids: [], portalLinks: 0, sig: "", size: 0 };
  const stack: TreeNode[] = [root];
  const all: TreeNode[] = [];
  for (const t of tokens) {
    if (t.kind !== "tag") continue;
    if (t.closing) {
      const idx = stack.map((n) => n.tag).lastIndexOf(t.name);
      if (idx > 0) stack.length = idx;
      continue;
    }
    const cls = (t.attrs.find((a) => a.name.toLowerCase() === "class")?.value ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(".");
    const href =
      t.name === "a" ? (t.attrs.find((a) => a.name.toLowerCase() === "href")?.value ?? "") : "";
    const node: TreeNode = {
      tag: t.name,
      cls,
      kids: [],
      portalLinks: href && isPortal(href) ? 1 : 0,
      sig: "",
      size: 1,
    };
    stack[stack.length - 1]!.kids.push(node);
    all.push(node);
    if (!VOID_TAGS.has(t.name) && !t.selfClosing) stack.push(node);
  }
  // Firma de abajo hacia arriba: los hijos se agregaron después que el padre
  for (const n of [...all].reverse()) {
    n.size = 1 + n.kids.reduce((a, k) => a + k.size, 0);
    n.portalLinks += n.kids.reduce((a, k) => a + k.portalLinks, 0);
    const sig = `${n.tag}.${n.cls}[${n.kids.map((k) => k.sig).join(",")}]`;
    n.sig = createHash("sha1").update(sig).digest("hex").slice(0, 10);
  }
  return all;
}

type RepeatedBlock = { tag: string; count: number; size: number; withPortalLink: boolean };

function repeatedBlocks(nodes: TreeNode[]): RepeatedBlock[] {
  const groups = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (n.size < 6) continue;
    const g = groups.get(n.sig) ?? [];
    g.push(n);
    groups.set(n.sig, g);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({
      tag: g[0]!.tag,
      count: g.length,
      size: g[0]!.size,
      withPortalLink: g.every((n) => n.portalLinks > 0),
    }))
    .sort(
      (a, b) =>
        Number(b.withPortalLink) - Number(a.withPortalLink) || b.count - a.count || b.size - a.size,
    )
    .slice(0, 5);
}

// ---------------------------------------------------------------------------------------------
// MIME mínimo (el repo no tiene un parser de .eml)
// ---------------------------------------------------------------------------------------------

type MimePart = { headers: Map<string, string>; body: string };
export type ParsedEml = {
  from: string | null;
  subject: string | null;
  htmlParts: string[];
};

/** `raw` es el archivo leído como latin1: un carácter por byte, así el decodificado por charset es exacto. */
function splitPart(raw: string): MimePart {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : "";
  const headers = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const c = line.indexOf(":");
    if (c <= 0) continue;
    const k = line.slice(0, c).trim().toLowerCase();
    if (!headers.has(k)) headers.set(k, line.slice(c + 1).trim());
  }
  return { headers, body };
}

function param(header: string, name: string): string | null {
  const m = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]*))`, "i").exec(header);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function decodeBody(part: MimePart): string {
  const cte = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
  const ct = part.headers.get("content-type") ?? "";
  let bytes: Buffer;
  if (cte === "quoted-printable") {
    const s = part.body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    bytes = Buffer.from(s, "latin1");
  } else if (cte === "base64") {
    bytes = Buffer.from(part.body.replace(/\s+/g, ""), "base64");
  } else {
    bytes = Buffer.from(part.body, "latin1");
  }
  const charset = (param(ct, "charset") ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function collectHtml(part: MimePart, depth: number, out: string[]): void {
  if (depth > 8) return;
  const ct = part.headers.get("content-type") ?? "text/plain";
  const type = ct.split(";")[0]!.trim().toLowerCase();
  if (type.startsWith("multipart/")) {
    const boundary = param(ct, "boundary");
    if (!boundary) return;
    const re = new RegExp(
      `(?:^|\\r?\\n)--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(--)?[ \\t]*(?=\\r?\\n|$)`,
      "g",
    );
    const marks = [...part.body.matchAll(re)];
    for (let k = 0; k < marks.length; k++) {
      const m = marks[k]!;
      if (m[1]) break; // delimitador de cierre
      const start = m.index + m[0].length;
      const end = marks[k + 1]?.index ?? part.body.length;
      collectHtml(
        splitPart(
          part.body
            .slice(start)
            .slice(0, end - start)
            .replace(/^\r?\n/, ""),
        ),
        depth + 1,
        out,
      );
    }
  } else if (type === "text/html") {
    out.push(decodeBody(part));
  }
}

/** RFC 2047 (=?utf-8?B?...?=) para que el asunto enmascarado tenga la forma correcta. */
function decodeWords(s: string): string {
  return s.replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
    (_m, cs: string, enc: string, text: string) => {
      try {
        const bytes =
          enc.toLowerCase() === "b"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) =>
                    String.fromCharCode(parseInt(h, 16)),
                  ),
                "latin1",
              );
        return new TextDecoder(cs.toLowerCase()).decode(bytes);
      } catch {
        return "";
      }
    },
  );
}

export function parseEml(raw: string): ParsedEml {
  const top = splitPart(raw);
  const htmlParts: string[] = [];
  collectHtml(top, 0, htmlParts);
  const subject = top.headers.get("subject");
  return {
    from: top.headers.get("from") ?? null,
    subject: subject === undefined ? null : decodeWords(subject),
    htmlParts,
  };
}

// ---------------------------------------------------------------------------------------------
// Remitente
// ---------------------------------------------------------------------------------------------

const GENERIC_LOCALS = new Set([
  "no_reply",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "alertas",
  "alerta",
  "avisos",
  "aviso",
  "info",
  "notificaciones",
  "notifications",
  "notification",
  "news",
  "newsletter",
  "ofertas",
  "empleos",
  "empleo",
  "jobs",
  "contacto",
  "hello",
  "mail",
  "mailer",
  "bounce",
  "bounces",
  "mensajes",
]);

/** Dirección sin el nombre visible. */
function senderParts(from: string | null): { local: string; domain: string } | null {
  if (!from) return null;
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const m = /^([^@\s]+)@([a-z0-9.-]+)$/.exec(addr);
  return m ? { local: m[1]!, domain: m[2]! } : null;
}

/** Dominio registrable aproximado: bumeran.com.ar, computrabajo.com. */
export function registrableDomain(domain: string): string {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const sld = labels[labels.length - 2]!;
  const tld = labels[labels.length - 1]!;
  const take =
    ["com", "net", "org", "co", "gob", "gov", "edu"].includes(sld) && tld.length === 2 ? 3 : 2;
  return labels.slice(-take).join(".");
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

export type SkeletonInput = {
  /** 1, 2, 3...: el número con el que se nombra la salida (nunca el nombre del archivo). */
  id: number;
  /** Contenido del .eml leído como latin1. */
  raw: string;
};

export type SkeletonOptions = {
  patterns: Pattern[];
  /**
   * Dominios del portal: salen en claro en las URL y cuentan como «links del portal». Sin esto, todo
   * host se enmascara (salvo el TLD y la infraestructura conocida) y el conteo usa el dominio del remitente.
   */
  portalDomains?: string[];
  /** false: no se conserva ningún texto, ni de plantilla. */
  keepTemplateText?: boolean;
};

export type SkeletonResult =
  | { id: number; ok: true; html: string; summary: string }
  | { id: number; ok: false; reason: string };

type Prepared = {
  id: number;
  tokens: Token[];
  flags: TokenizeFlags;
  parsed: ParsedEml;
  texts: Set<string>;
  /** Textos que siguen a un saludo en este email: nunca plantilla. */
  followers: Set<string>;
};

/** ¿Hay algo con forma de dirección de email que no esté enmascarado (solo x, X, 9 y signos)? */
function leakedAddress(s: string): boolean {
  for (const m of s.matchAll(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/gu)) {
    if (/[\p{L}\p{N}]/u.test(m[0].replace(/[xX9]/g, ""))) return true;
  }
  return false;
}

function describeHits(hits: Hit[]): string {
  const ids = [...new Set(hits.map((h) => h.id))].sort((a, b) => a - b);
  const lines = [...new Set(hits.map((h) => /:(\d+)$/.exec(h.where)?.[1]).filter(Boolean))].slice(
    0,
    5,
  );
  return `coincide con el patrón n.º ${ids.join(", ")}${lines.length ? ` (línea ${lines.join(", ")} de la salida)` : ""}`;
}

/**
 * Texto de plantilla: idéntico en ≥ 2 emails y en al menos la mitad de la carpeta (un mismo aviso
 * repetido en 2 de 6 alertas no es plantilla), sin dígitos ni «@», sin saludo, sin patrón de privacidad.
 */
function templateKeys(prepared: Prepared[], patterns: Pattern[]): Set<string> {
  const count = new Map<string, number>();
  for (const p of prepared) for (const k of p.texts) count.set(k, (count.get(k) ?? 0) + 1);
  const minEmails = Math.max(2, Math.ceil(prepared.length / 2));
  const keep = new Set<string>();
  // Si en algún email el texto sigue a un saludo, en ninguno se conserva: es un nombre
  const names = new Set<string>();
  for (const p of prepared) for (const k of p.followers) names.add(k);
  for (const [k, n] of count) {
    if (n < minEmails || names.has(k)) continue;
    if (k.length > 120 || /[@\p{N}]/u.test(k) || /[<>]/.test(k)) continue;
    if (GREETING_RE.test(k) || /&/.test(k)) continue;
    if (scanLine(patterns, k).length > 0 || scanLine(patterns, norm(k)).length > 0) continue;
    keep.add(k);
  }
  return keep;
}

/**
 * Esqueletos de una carpeta de .eml. Falla cerrado: sin patrones lanza; un email con MIME o HTML
 * ilegible, o cuya salida coincide con algún patrón, queda como `ok: false` sin HTML.
 */
export function buildSkeletons(
  inputs: SkeletonInput[],
  opts: SkeletonOptions,
): { results: SkeletonResult[]; resumen: string } {
  if (opts.patterns.length === 0) {
    throw new Error("sin patrones de privacidad: no se puede verificar nada");
  }
  const results: SkeletonResult[] = [];
  const prepared: Prepared[] = [];

  for (const input of inputs) {
    let parsed: ParsedEml;
    try {
      parsed = parseEml(input.raw);
    } catch {
      results.push({ id: input.id, ok: false, reason: "no se pudo leer el MIME" });
      continue;
    }
    const html = parsed.htmlParts[0];
    if (html === undefined) {
      results.push({ id: input.id, ok: false, reason: "el email no tiene parte HTML" });
      continue;
    }
    const tk = tokenize(html);
    if (!tk.ok) {
      results.push({ id: input.id, ok: false, reason: `HTML ilegible: ${tk.reason}` });
      continue;
    }
    const texts = new Set<string>();
    for (const t of tk.tokens) if (t.kind === "text" && textKey(t.raw)) texts.add(textKey(t.raw));
    prepared.push({
      id: input.id,
      tokens: tk.tokens,
      flags: tk.flags,
      parsed,
      texts,
      followers: greetingFollowers(tk.tokens),
    });
  }

  const keep =
    opts.keepTemplateText === false ? new Set<string>() : templateKeys(prepared, opts.patterns);

  for (const p of prepared) {
    // Solo los --portal explícitos salen en claro; el dominio del remitente es un dato más
    const ctx: HostContext = { clearHosts: (opts.portalDomains ?? []).map((d) => d.toLowerCase()) };
    const html = render(p.tokens, keep, ctx);
    const sender = senderParts(p.parsed.from);
    const portals = opts.portalDomains?.length
      ? opts.portalDomains
      : sender
        ? [registrableDomain(sender.domain)]
        : [];
    const isPortal = (href: string): boolean => {
      const h = hostOf(href);
      return h !== null && portals.some((d) => h === d || h.endsWith(`.${d}`));
    };
    let totalLinks = 0;
    let portalLinks = 0;
    for (const t of p.tokens) {
      if (t.kind !== "tag" || t.closing || t.name !== "a") continue;
      const href = t.attrs.find((a) => a.name.toLowerCase() === "href")?.value;
      if (!href) continue;
      totalLinks++;
      if (isPortal(href)) portalLinks++;
    }
    const kept = [...p.texts].filter((k) => keep.has(k)).length;
    const blocks = repeatedBlocks(buildTree(p.tokens, isPortal));

    const senderLine = sender
      ? `${maskHost(sender.domain, ctx)} · parte local: ${GENERIC_LOCALS.has(sender.local) ? sender.local : maskShape(sender.local)}`
      : "(no se pudo leer)";
    const summary = [
      `## eml ${p.id}`,
      "",
      `- remitente (dominio): ${senderLine}`,
      `- asunto (enmascarado): ${p.parsed.subject === null ? "(sin asunto)" : maskHtmlText(p.parsed.subject)}`,
      `- partes HTML: ${p.parsed.htmlParts.length}${p.parsed.htmlParts.length > 1 ? " (solo se procesó la primera)" : ""}`,
      `- dominios del portal: ${portals.length ? portals.map((d) => maskHost(d, ctx)).join(", ") : "(ninguno)"}`,
      `- links: ${totalLinks} en total, ${portalLinks} a dominios del portal`,
      `- JSON-LD: ${p.flags.jsonLd ? `sí (tipos: ${p.flags.jsonLdTypes.join(", ") || "ninguno legible"})` : "no"} · microdata: ${p.flags.microdata ? "sí" : "no"}`,
      `- textos de plantilla conservados tal cual: ${kept}`,
      `- bloques repetidos (candidatos a «un aviso»; * = todos con link al portal):`,
      ...(blocks.length
        ? blocks.map(
            (b) =>
              `  - <${b.tag}> × ${b.count}, ${b.size} etiquetas${b.withPortalLink ? " *" : ""}`,
          )
        : ["  - ninguno"]),
      "",
    ].join("\n");

    // Falla cerrado: lo que se escribiría (esqueleto + sección del resumen) pasa por los patrones
    const hits = [
      ...scanText(opts.patterns, "salida", html),
      ...scanText(opts.patterns, "resumen", summary),
    ];
    if (hits.length > 0) {
      results.push({ id: p.id, ok: false, reason: describeHits(hits) });
      continue;
    }
    // Una dirección de email que sobrevive al enmascarado es un error nuestro: no se escribe
    if (leakedAddress(html) || leakedAddress(summary)) {
      results.push({ id: p.id, ok: false, reason: "quedó algo con forma de dirección de email" });
      continue;
    }
    results.push({ id: p.id, ok: true, html, summary });
  }

  results.sort((a, b) => a.id - b.id);
  const ok = results.filter((r) => r.ok);
  const resumen = [
    "# Esqueletos de .eml",
    "",
    `Emails procesados: ${results.length} · con esqueleto: ${ok.length} · bloqueados: ${results.length - ok.length}`,
    "",
    "Texto enmascarado por forma (letras → x/X, dígitos → 9). Solo se conserva tal cual el texto de plantilla",
    "(idéntico en 2 o más emails, sin dígitos ni «@», sin saludo ni patrón de privacidad). Revisá igual antes de compartir.",
    "",
    ...results.map((r) =>
      r.ok ? r.summary : `## eml ${r.id}\n\n- BLOQUEADO, sin esqueleto: ${r.reason}\n`,
    ),
  ].join("\n");
  return { results, resumen };
}
