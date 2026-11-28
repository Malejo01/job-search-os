import {
  makeSalaryOriginal,
  MAX_EMAIL_HTML_CHARS,
  stripTags,
  tagBlocks,
  type RawJob,
} from "@job-search-os/pipeline";
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

/**
 * Código estable del motivo de un fallo (R32-07): va al principio del texto que acaba en la cola manual
 * (`inbound_emails.error`, de 120 caracteres como máximo), así se agrupan los fallos de un vistazo y se
 * sabe qué parte del email cambió sin abrirlo. Cada código es una causa distinta.
 */
export const GOB_CODIGOS_MOTIVO = [
  "sin_html",
  "html_grande",
  "sin_avisos",
  "demasiados_avisos",
  "tarjeta_sin_link",
  "tarjeta_sin_postular",
  "tarjeta_estructura",
  "sin_titulo",
  "contrato_desconocido",
  "seniority_desconocido",
  "sin_empresa",
  "salario_ilegible",
  "titulo_formato",
] as const;
export type CodigoMotivoGob = (typeof GOB_CODIGOS_MOTIVO)[number];

type Falla = { error: string };
const falla = (codigo: CodigoMotivoGob, detalle: string): Falla => ({
  error: `${codigo}: ${detalle}`,
});

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

type Salario = Pick<
  RawJob,
  "salaryMinUsd" | "salaryMaxUsd" | "salaryPeriod" | "salaryNote" | "salaryOriginal"
>;
const SIN_SALARIO: Salario = {
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  salaryNote: null,
};

/**
 * Un monto como lo escribe el email: «2200», «3.000», «3,000» o «2.500,50». Los separadores seguidos de
 * exactamente tres dígitos son de miles; el último con uno o dos dígitos es decimal y se redondea. Todo lo
 * demás es ilegible (NaN): nunca se adivina, porque un punto mal leído multiplica el sueldo por mil.
 */
export function montoDeEmail(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  const decimal = /^(\d{1,3}(?:[.,]\d{3})*|\d+)[.,](\d{1,2})$/.exec(s);
  if (decimal) return Math.round(Number(`${decimal[1]!.replace(/[.,]/g, "")}.${decimal[2]}`));
  return Number.NaN;
}

/**
 * "$2200 - 2500 USD/mes" o "$3.000 USD/mes". Otra cosa con "USD/mes" no se entiende: un monto que no se
 * puede leer o un mínimo mayor que el máximo.
 */
function salario(t: string): Salario | { error: string } {
  const m = /\$\s*([\d.,]+)(?:\s*-\s*\$?\s*([\d.,]+))?\s*USD\/mes/.exec(t);
  if (!m) return { error: "salario ilegible" };
  const min = montoDeEmail(m[1]!);
  const max = m[2] ? montoDeEmail(m[2]) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { error: "salario ilegible" };
  }
  return {
    salaryMinUsd: min,
    salaryMaxUsd: max,
    salaryPeriod: "mensual",
    salaryNote: "USD/mes según Get on Board",
    salaryOriginal: makeSalaryOriginal({ min, max, currency: "USD", period: "mensual" }),
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
function tarjeta(card: string, n: number): Aviso | Falla {
  const slug = primerSlug(card);
  if (!slug) return falla("tarjeta_sin_link", `tarjeta ${n} sin link a un aviso`);

  const m = partesDeTarjeta(card);
  if (!m) return falla("tarjeta_estructura", `aviso ${slug}: estructura de tarjeta desconocida`);
  const title = texto(m.title);
  if (!title) return falla("sin_titulo", `aviso ${slug} sin título`);

  const partes = texto(m.linea)
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  const contract = partes.at(-1);
  const seniority = partes.length === 2 ? partes[0]! : null;
  if (!contract || partes.length > 2 || !CONTRATOS.includes(contract)) {
    return falla("contrato_desconocido", `aviso ${slug} («${texto(m.linea)}»)`);
  }
  if (seniority !== null && !SENIORITIES.includes(seniority)) {
    return falla("seniority_desconocido", `aviso ${slug} («${seniority}»)`);
  }

  const detalle = m.detalle;
  const company = texto(
    tagBlocks(detalle, "strong", { caseSensitive: true, limit: 1 })[0]?.inner ?? "",
  );
  if (!company) return falla("sin_empresa", `aviso ${slug} sin empresa`);

  const resto = texto(detalle);
  const sal = resto.includes("USD") ? salario(resto) : SIN_SALARIO;
  if ("error" in sal) return falla("salario_ilegible", `aviso ${slug} («${resto}»)`);

  return { slug, title, company, seniority, contract, salario: sal };
}

const MAX_APERTURA_CONTRATO = 2_000;
const MAX_DESTACADOS = 100;

/** Bloque del formato «destacados»: desde el `<div>` que abre hasta el cierre del `<h1>` y lo que sigue. */
function destacado(antes: string, h1: string, despues: string): Aviso | Falla {
  const slug = primerSlug(h1);
  if (!slug) return falla("tarjeta_sin_link", "destacado sin link a un aviso");

  const [tituloRaw = "", ...extra] = texto(h1).split(/\s+\|\s+/);
  const title = tituloRaw.trim();
  if (!title) return falla("sin_titulo", `destacado ${slug} sin título`);
  if (extra.length > 1) {
    return falla("titulo_formato", `destacado ${slug}: título con formato desconocido`);
  }
  const seniority = extra[0] ?? null;
  if (seniority !== null && !SENIORITIES.includes(seniority)) {
    return falla("seniority_desconocido", `destacado ${slug} («${seniority}»)`);
  }

  // la empresa es el último <strong> del bloque, justo antes del <h1>
  const inicio = antes.lastIndexOf("<div");
  const strongs = tagBlocks(antes.slice(inicio), "strong", { caseSensitive: true });
  const company = texto(strongs.at(-1)?.inner ?? "");
  if (!company) return falla("sin_empresa", `destacado ${slug} sin empresa`);

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
    return falla("contrato_desconocido", `destacado ${slug} («${contract}»)`);
  }

  return { slug, title, company, seniority, contract, salario: SIN_SALARIO };
}

/**
 * Forma del email en conteos, sin ningún texto: se agrega al motivo cuando no se encontró ningún aviso,
 * para distinguir un email que de verdad no trae avisos (solo perks) de uno cuyo HTML cambió (hay links a
 * avisos pero ya no hay tarjetas ni destacados conocidos).
 */
export function formaDelEmail(html: string): {
  tarjetas: number;
  destacados: number;
  linksAAvisos: number;
} {
  let linksAAvisos = 0;
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (slugDe(href!)) linksAAvisos++;
  }
  return {
    tarjetas: html.split(/<div class="job"/).length - 1,
    destacados: tagBlocks(html, "h1", { caseSensitive: true }).filter((h1) =>
      primerSlug(html.slice(h1.start, h1.end)),
    ).length,
    linksAAvisos,
  };
}

function avisos(html: string): Aviso[] | Falla {
  const out: Aviso[] = [];

  for (const h1 of tagBlocks(html, "h1", { caseSensitive: true })) {
    const bloque = html.slice(h1.start, h1.end);
    if (!primerSlug(bloque)) continue; // un <h1> que no es un aviso (título del email)
    if (out.length >= MAX_DESTACADOS) {
      return falla("demasiados_avisos", "demasiados avisos destacados");
    }
    const res = destacado(html.slice(0, h1.start), bloque, html.slice(h1.end));
    if ("error" in res) return res;
    out.push(res);
  }

  let n = 0;
  for (const card of html.split(/<div class="job"/).slice(1)) {
    n++;
    const fin = card.indexOf(">Postular");
    if (fin < 0) return falla("tarjeta_sin_postular", `tarjeta ${n} sin botón «Postular»`);
    const res = tarjeta(card.slice(0, fin), n);
    if ("error" in res) return res;
    out.push(res);
  }

  const vistos = new Set<string>();
  return out.filter((a) => (vistos.has(a.slug) ? false : (vistos.add(a.slug), true)));
}

export const getonboardParser: EmailParser = {
  name: "getonboard",
  parse(email: InboundEmailContent): ParseResult {
    if (!email.html) {
      return { ok: false, reason: "sin_html: email de Get on Board sin HTML: cola manual" };
    }
    if (email.html.length > MAX_EMAIL_HTML_CHARS) {
      return {
        ok: false,
        reason: "html_grande: email de Get on Board demasiado grande: cola manual",
      };
    }
    const res = avisos(email.html);
    if ("error" in res) return { ok: false, reason: clampReason(`${res.error}: cola manual`) };
    if (res.length === 0) {
      const f = formaDelEmail(email.html);
      return {
        ok: false,
        reason: clampReason(
          `sin_avisos: email de Get on Board sin avisos (tarjetas ${f.tarjetas}, destacados ${f.destacados}, links ${f.linksAAvisos}): cola manual`,
        ),
      };
    }
    return { ok: true, jobs: res.map(rawJob) };
  },
};
