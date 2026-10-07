import type { RawJob } from "@job-search-os/pipeline";
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
export const WWR_CATEGORIES = [
  "remote-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-full-stack-programming-jobs",
  "remote-devops-sysadmin-jobs",
] as const;

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

function decodeXml(text: string): string {
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
function tagText(xml: string, tag: string): string | null {
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
      kind: "other",
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
    jdText: htmlToText(item.description) || null,
    postedAt: new Date(item.pubDate),
    tags: item.category ? [item.category] : [],
    seniority: null,
    lang: null,
  };
}

export type FetchWwrOptions = {
  /** Solo avisos publicados desde esta fecha (filtro en cliente por `pubDate`). */
  since: Date;
  categories?: readonly string[];
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
};

export function wwrCategoryUrl(baseUrl: string, category: string): string {
  return `${baseUrl}/${encodeURIComponent(category)}.rss`;
}

/** Una llamada por categoría; deduplica por guid (o link) entre categorías. */
export async function fetchWwrJobs(options: FetchWwrOptions): Promise<FetchWwrResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? WWR_BASE_URL;
  const categories = options.categories ?? WWR_CATEGORIES;
  const sinceMs = options.since.getTime();

  const byId = new Map<string, RawJob>();
  let seen = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const category of categories) {
    let parsed: ReturnType<typeof parseWwrFeed>;
    try {
      const res = await fetchImpl(wwrCategoryUrl(baseUrl, category), {
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      parsed = parseWwrFeed(await res.text());
    } catch (e) {
      errors.push(`We Work Remotely ${category}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    skipped += parsed.skipped;
    seen += parsed.items.length;
    for (const item of parsed.items) {
      if (Date.parse(item.pubDate) < sinceMs) continue;
      const key = item.guid ?? item.link;
      if (!byId.has(key)) byId.set(key, mapWwrJob(item, category));
    }
  }
  if (categories.length > 0 && errors.length === categories.length) {
    throw new Error(errors.join("; "));
  }
  return { jobs: [...byId.values()], seen, skipped, errors };
}
