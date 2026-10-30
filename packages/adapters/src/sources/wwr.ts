import { findAtsLinks, type RawJob } from "@job-search-os/pipeline";
import { sourceErrorCode, type SourceErrorCode } from "./error-code";
import { htmlToText } from "./getonboard";

/**
 * We Work Remotely, RSS por categoría. Formato documentado, A VERIFICAR contra la fuente real
 * (se escribió sin red; ver docs/sources/wwr.md):
 * - `GET https://weworkremotely.com/categories/<categoría>.rss`.
 * - Cada `<item>`: `<title>` "Empresa: Puesto", `<region>`, `<category>`, `<type>`,
 *   `<description>` (HTML, a veces CDATA o con entidades), `<pubDate>` (RFC 822), `<link>`, `<guid>`.
 * - Parseo mínimo sin dependencias; un item sin title/link/pubDate se saltea (falla cerrado por item).
 */
export const WWR_BASE_URL = "https://weworkremotely.com/categories";
/**
 * Categorías del pool (ronda 47): desarrollo, producto, soporte y diseño. Slugs de RSS con el patrón
 * `remote-<categoría>-jobs`. A VERIFICAR con `pool:fetch wwr --dry-run`: se escribieron sin red; una
 * categoría que no exista devuelve HTTP 404 y el informe del dry-run la marca.
 */
export const WWR_POOL_CATEGORIES: readonly string[] = [
  // Las específicas primero y la general al final; igual, un aviso en varias categorías las junta todas
  "remote-full-stack-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-front-end-programming-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-product-jobs",
  "remote-customer-support-jobs",
  "remote-design-jobs",
  "remote-programming-jobs",
];

export type WwrItem = {
  title: string;
  link: string;
  guid: string | null;
  pubDate: string;
  region: string | null;
  category: string | null;
  type: string | null;
  description: string | null;
  /** Fragmento `<item>…</item>` tal cual llegó. */
  xml: string;
};

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return XML_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Contenido de `<tag>` dentro de un item: CDATA literal, o texto con entidades XML decodificadas. */
export function tagText(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!m) return null;
  const inner = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  const text = cdata ? cdata[1]! : decodeXml(inner);
  return text.trim() || null;
}

/**
 * Items válidos de un feed RSS y cantidad de items salteados (sin title, link o pubDate válidos).
 */
export function parseWwrFeed(xml: string): { items: WwrItem[]; skipped: number } {
  const items: WwrItem[] = [];
  let skipped = 0;
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const chunk = m[1]!;
    const title = tagText(chunk, "title");
    const link = tagText(chunk, "link");
    const pubDate = tagText(chunk, "pubDate");
    if (!title || !link || !pubDate || Number.isNaN(Date.parse(pubDate))) {
      skipped++;
      continue;
    }
    items.push({
      title,
      link,
      guid: tagText(chunk, "guid"),
      pubDate,
      region: tagText(chunk, "region"),
      category: tagText(chunk, "category"),
      type: tagText(chunk, "type"),
      description: tagText(chunk, "description"),
      xml: m[0],
    });
  }
  return { items, skipped };
}

/**
 * `htmlToText` descarta los `href`: el link al sitio de empleos de la empresa (Greenhouse, Lever,
 * Ashby, Workable) se perdía. Se rescatan los que `findAtsLinks` reconoce y van al final de la JD
 * en una línea de texto plano (dato, no instrucción).
 */
function jdWithAtsLinks(description: string | null): string | null {
  const text = htmlToText(description);
  const hrefs = [...(description ?? "").matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) =>
    decodeXml(m[1] ?? m[2] ?? ""),
  );
  const links = findAtsLinks(hrefs.join("\n"))
    .map((l) => l.url)
    .filter((url) => !text.includes(url));
  if (links.length === 0) return text || null;
  const line = `Sitio de empleos de la empresa: ${links.join(" ")}`;
  return text ? `${text}\n\n${line}` : line;
}

/** Un item del feed → RawJob. Puro: no hace I/O. `categorySlug` va en el nombre de la fuente. */
export function mapWwrJob(item: WwrItem, categorySlug: string): RawJob {
  const sep = item.title.indexOf(":");
  const company = sep > 0 ? item.title.slice(0, sep).trim() : "";
  const title = sep > 0 ? item.title.slice(sep + 1).trim() : item.title.trim();

  const region = item.region?.trim() ?? "";
  let locationRaw: string;
  let countriesAllowed: string[] | null;
  if (!region) {
    locationRaw = "Remoto (países no especificados)";
    countriesAllowed = null;
  } else if (/^anywhere in the world$/i.test(region)) {
    locationRaw = `Remoto (${region})`;
    countriesAllowed = ["*"];
  } else {
    locationRaw = `Remoto (${region})`;
    countriesAllowed = null;
  }

  return {
    source: {
      kind: "wwr",
      name: `WWR ${categorySlug}`,
      externalId: `wwr:${item.guid ?? item.link}`,
      url: item.link,
      rawRef: null,
      original: { contentType: "application/rss+xml", body: item.xml },
    },
    title: title || item.title.trim(),
    companyRaw: company || "desconocida",
    locationRaw,
    countriesAllowed,
    modality: "remoto",
    contractType: item.type,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: jdWithAtsLinks(item.description),
    postedAt: new Date(item.pubDate),
    tags: item.category ? [item.category] : [],
    // El slug del feed alimenta el `role_hints` del pool (SOURCE_CATEGORY_ROLES.wwr)
    categories: [categorySlug],
    seniority: null,
    lang: null,
  };
}

export type FetchWwrOptions = {
  /** Solo avisos publicados desde esta fecha (filtro en cliente por `pubDate`). */
  since: Date;
  categories?: readonly string[];
  /** Si viene, se manda como cabecera `user-agent`. */
  userAgent?: string;
  /**
   * Con `true`, si algunas categorías fallan pero otras no, se devuelve lo juntado con
   * `partialError`. Default `false`: el primer error corta. Si fallan todas, siempre tira.
   */
  partialOnError?: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchWwrResult = {
  jobs: RawJob[];
  /** Items válidos vistos antes de filtrar por fecha y deduplicar. */
  seen: number;
  /** Items descartados por estructura incompleta. */
  skipped: number;
  /** Categorías que fallaron (fuente + categoría + causa); las demás siguieron. */
  errors: string[];
  /** Categorías que dieron 404: se saltean y no cuentan como error (el dry-run las muestra). */
  missingCategories: string[];
  /** Código cerrado del primer error cuando se devolvió lo juntado (`partialOnError`); si no, null. */
  partialError: SourceErrorCode | null;
};

export function wwrCategoryUrl(baseUrl: string, category: string): string {
  return `${baseUrl}/${encodeURIComponent(category)}.rss`;
}

/** Una llamada por categoría; deduplica por guid (o link) entre categorías. */
export async function fetchWwrJobs(options: FetchWwrOptions): Promise<FetchWwrResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? WWR_BASE_URL;
  const categories = options.categories ?? WWR_POOL_CATEGORIES;
  const sinceMs = options.since.getTime();
  const headers: Record<string, string> = {
    accept: "application/rss+xml, application/xml, text/xml",
  };
  if (options.userAgent) headers["user-agent"] = options.userAgent;

  const byId = new Map<string, RawJob>();
  let seen = 0;
  let skipped = 0;
  const errors: string[] = [];
  const missingCategories: string[] = [];
  let partialError: SourceErrorCode | null = null;
  for (const category of categories) {
    let parsed: ReturnType<typeof parseWwrFeed>;
    try {
      const res = await fetchImpl(wwrCategoryUrl(baseUrl, category), { headers });
      if (res.status === 404) {
        // Una categoría que no existe no deja la fuente en `partial` para siempre: se informa aparte
        missingCategories.push(category);
        continue;
      }
      if (!res.ok) throw new Error(`We Work Remotely ${category}: HTTP ${res.status}`);
      parsed = parseWwrFeed(await res.text());
    } catch (e) {
      if (!options.partialOnError) throw e;
      partialError ??= sourceErrorCode(e);
      const message = e instanceof Error ? e.message : String(e);
      errors.push(
        message.startsWith("We Work Remotely")
          ? message
          : `We Work Remotely ${category}: ${message}`,
      );
      continue;
    }
    skipped += parsed.skipped;
    seen += parsed.items.length;
    for (const item of parsed.items) {
      if (Date.parse(item.pubDate) < sinceMs) continue;
      const key = item.guid ?? item.link;
      const existing = byId.get(key);
      if (!existing) byId.set(key, mapWwrJob(item, category));
      else if (!existing.categories?.includes(category)) {
        // El mismo aviso en otra categoría: se unen, para no perder la señal del puesto
        existing.categories = [...(existing.categories ?? []), category];
      }
    }
  }
  if (categories.length > 0 && errors.length + missingCategories.length === categories.length) {
    throw new Error(
      errors.length > 0 ? errors.join("; ") : "We Work Remotely: HTTP 404 en todas las categorías",
    );
  }
  return { jobs: [...byId.values()], seen, skipped, errors, missingCategories, partialError };
}
