import { MAX_EMAIL_HTML_CHARS, stripTags, tagBlocks, type RawJob } from "@job-search-os/pipeline";
import { clampReason } from "./motivo";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser de los emails de Get on Board (JS-022). Cubre los dos formatos reales vistos:
 *   - «selección de empleos» → tarjetas `class="job"`: título, "Seniority | Contrato", empresa y
 *     salario en USD/mes.
 *   - «empleos destacados» → un `<h1>` con "Título | Seniority", la empresa en el `<strong>`
 *     anterior y el contrato en el `<p><strong>` siguiente. La descripción que trae está
 *     recortada ("...") y no se usa como JD.
 *
 * Los links vienen envueltos en un tracker y codificados; el aviso se identifica por el slug de
 * `/empleos/<categoría>/<slug>`, que es el mismo id que usa la API. La URL se arma como la
 * publica la API (`/jobs/<slug>`) para que el dedup cruce el aviso con el que trae el cron.
 *
 * Falla cerrado: sin HTML, sin avisos, o con un aviso que no se entiende (sin empresa, seniority
 * o contrato desconocido, salario ilegible) → `{ ok: false }` y el email entero a la cola manual.
 * Lo que el email no dice queda null: ubicación, países, modalidad, JD, candidatos, fecha.
 */

const SENIORITIES = [
  "Sin experiencia",
  "Junior",
  "Semi Senior",
  "Senior",
  "Experto",
  "No experience required",
  "Expert",
];
const CONTRATOS = ["Full time", "Part time", "Freelance", "Práctica", "Internship"];

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Texto visible de un fragmento: sin tags, entidades decodificadas, espacios colapsados. */
function texto(html: string): string {
  return stripTags(html)
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

/** Slug del aviso en un href, con o sin tracker: `getonbrd.com/empleos/<cat>/<slug>`. */
function slugDe(href: string): string | null {
  let url = href.replace(/&amp;/g, "&");
  try {
    url = decodeURIComponent(url);
  } catch {
    // un href mal codificado se busca tal cual
  }
  return (
    /getonbrd\.com\/(?:empleos|jobs)\/(?:[a-z0-9-]+\/)?([a-z0-9-]+)(?=[?#/&]|$)/i.exec(url)?.[1] ??
    null
  );
}

const primerSlug = (html: string) => {
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    const slug = slugDe(href!);
    if (slug) return slug;
  }
  return null;
};

type Salario = Pick<RawJob, "salaryMinUsd" | "salaryMaxUsd" | "salaryPeriod" | "salaryNote">;
const SIN_SALARIO: Salario = {
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  salaryNote: null,
};

/** "$2200 - 2500 USD/mes" o "$3.000 USD/mes". Otra cosa con "USD/mes" no se entiende. */
function salario(t: string): Salario | { error: string } {
  const m = /\$\s*([\d.,]+)(?:\s*-\s*\$?\s*([\d.,]+))?\s*USD\/mes/.exec(t);
  if (!m) return { error: "salario ilegible" };
  const n = (s: string) => Number(s.replace(/[.,]/g, ""));
  const min = n(m[1]!);
  const max = m[2] ? n(m[2]) : min;
  return {
    salaryMinUsd: min,
    salaryMaxUsd: max,
    salaryPeriod: "mensual",
    salaryNote: "USD/mes según Get on Board",
  };
}

type Aviso = {
  slug: string;
  title: string;
  company: string;
  seniority: string | null;
  contract: string;
  salario: Salario;
};

function rawJob(a: Aviso): RawJob {
  return {
    source: {
      kind: "email_getonboard",
      name: "Get on Board (email)",
      externalId: a.slug,
      url: `https://www.getonbrd.com/jobs/${a.slug}`,
      rawRef: null,
    },
    title: a.title,
    companyRaw: a.company,
    locationRaw: null,
    // El email no dice desde qué países se contrata: null para que el prefiltro marque riesgo.
    countriesAllowed: null,
    modality: "desconocida",
    contractType: a.contract,
    ...a.salario,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: null,
    postedAt: null,
    tags: [],
    seniority: a.seniority,
    lang: null,
  };
}

/** Cuántos `<strong>` de una tarjeta se prueban como título: en los emails reales es el primero. */
const MAX_STRONGS_POR_TARJETA = 5;

/**
 * Título, línea de seniority y detalle de una tarjeta: `<strong>título</strong> <span>línea</span> <br>
 * <span>detalle…</a>`. Se avanza por tramos para no reintentar desde cada `<strong>`.
 */
function partesDeTarjeta(card: string): { title: string; linea: string; detalle: string } | null {
  const strongs = tagBlocks(card, "strong", {
    caseSensitive: true,
    limit: MAX_STRONGS_POR_TARJETA,
  });
  for (const strong of strongs) {
    const apertura = /\s*<span[^>]*>/y;
    apertura.lastIndex = strong.end;
    if (!apertura.test(card)) continue;
    const finLinea = card.indexOf("</span>", apertura.lastIndex);
    if (finLinea < 0) return null;
    const salto = /<\/span>\s*<br>\s*<span[^>]*>/y;
    salto.lastIndex = finLinea;
    if (!salto.test(card)) continue;
    const finDetalle = card.indexOf("</a>", salto.lastIndex);
    if (finDetalle < 0) return null;
    return {
      title: strong.inner,
      linea: card.slice(apertura.lastIndex, finLinea),
      detalle: card.slice(salto.lastIndex, finDetalle),
    };
  }
  return null;
}

/** Tarjeta del formato «selección». */
function tarjeta(card: string): Aviso | { error: string } {
  const slug = primerSlug(card);
  if (!slug) return { error: "tarjeta sin link a un aviso" };

  const m = partesDeTarjeta(card);
  if (!m) return { error: `aviso ${slug}: estructura de tarjeta desconocida` };
  const title = texto(m.title);
  if (!title) return { error: `aviso ${slug} sin título` };

  const partes = texto(m.linea)
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  const contract = partes.at(-1);
  const seniority = partes.length === 2 ? partes[0]! : null;
  if (!contract || partes.length > 2 || !CONTRATOS.includes(contract)) {
    return { error: `aviso ${slug}: contrato desconocido («${texto(m.linea)}»)` };
  }
  if (seniority !== null && !SENIORITIES.includes(seniority)) {
    return { error: `aviso ${slug}: seniority desconocido («${seniority}»)` };
  }

  const detalle = m.detalle;
  const company = texto(
    tagBlocks(detalle, "strong", { caseSensitive: true, limit: 1 })[0]?.inner ?? "",
  );
  if (!company) return { error: `aviso ${slug} sin empresa` };

  const resto = texto(detalle);
  const sal = resto.includes("USD") ? salario(resto) : SIN_SALARIO;
  if ("error" in sal) return { error: `aviso ${slug}: ${sal.error}` };

  return { slug, title, company, seniority, contract, salario: sal };
}

const MAX_APERTURA_CONTRATO = 2_000;
const MAX_DESTACADOS = 100;

/** Bloque del formato «destacados»: desde el `<div>` que abre hasta el cierre del `<h1>` y lo que sigue. */
function destacado(antes: string, h1: string, despues: string): Aviso | { error: string } {
  const slug = primerSlug(h1);
  if (!slug) return { error: "destacado sin link a un aviso" };

  const [tituloRaw = "", ...extra] = texto(h1).split(/\s+\|\s+/);
  const title = tituloRaw.trim();
  if (!title) return { error: `destacado ${slug} sin título` };
  if (extra.length > 1) return { error: `destacado ${slug}: título con formato desconocido` };
  const seniority = extra[0] ?? null;
  if (seniority !== null && !SENIORITIES.includes(seniority)) {
    return { error: `destacado ${slug}: seniority desconocido («${seniority}»)` };
  }

  // la empresa es el último <strong> del bloque, justo antes del <h1>
  const inicio = antes.lastIndexOf("<div");
  const strongs = tagBlocks(antes.slice(inicio), "strong", { caseSensitive: true });
  const company = texto(strongs.at(-1)?.inner ?? "");
  if (!company) return { error: `destacado ${slug} sin empresa` };

  const apertura = /^\s*<p[^>]*>\s*(?=<strong)/.exec(despues.slice(0, MAX_APERTURA_CONTRATO));
  const contract = texto(
    apertura
      ? (tagBlocks(despues.slice(apertura[0].length), "strong", {
          caseSensitive: true,
          limit: 1,
        })[0]?.inner ?? "")
      : "",
  );
  if (!CONTRATOS.includes(contract)) {
    return { error: `destacado ${slug}: contrato desconocido («${contract}»)` };
  }

  return { slug, title, company, seniority, contract, salario: SIN_SALARIO };
}

function avisos(html: string): Aviso[] | { error: string } {
  const out: Aviso[] = [];

  for (const h1 of tagBlocks(html, "h1", { caseSensitive: true })) {
    const bloque = html.slice(h1.start, h1.end);
    if (!primerSlug(bloque)) continue; // un <h1> que no es un aviso (título del email)
    if (out.length >= MAX_DESTACADOS) return { error: "demasiados avisos destacados" };
    const res = destacado(html.slice(0, h1.start), bloque, html.slice(h1.end));
    if ("error" in res) return res;
    out.push(res);
  }

  for (const card of html.split(/<div class="job"/).slice(1)) {
    const fin = card.indexOf(">Postular");
    if (fin < 0) return { error: "tarjeta sin botón «Postular»" };
    const res = tarjeta(card.slice(0, fin));
    if ("error" in res) return res;
    out.push(res);
  }

  const vistos = new Set<string>();
  return out.filter((a) => (vistos.has(a.slug) ? false : (vistos.add(a.slug), true)));
}

export const getonboardParser: EmailParser = {
  name: "getonboard",
  parse(email: InboundEmailContent): ParseResult {
    if (!email.html) return { ok: false, reason: "email de Get on Board sin HTML: cola manual" };
    if (email.html.length > MAX_EMAIL_HTML_CHARS) {
      return { ok: false, reason: "email de Get on Board demasiado grande: cola manual" };
    }
    const res = avisos(email.html);
    if ("error" in res) return { ok: false, reason: clampReason(`${res.error}: cola manual`) };
    if (res.length === 0) {
      return { ok: false, reason: "email de Get on Board sin avisos: cola manual" };
    }
    return { ok: true, jobs: res.map(rawJob) };
  },
};
