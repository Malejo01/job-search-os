import type { RawJob } from "@job-search-os/pipeline";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser del mail de recomendaciones de Computrabajo que llega a la casilla de una persona (R11-4).
 * Estructura (4 esqueletos de la R8-1; solo uno trae avisos para leer):
 *   - Una tarjeta por aviso: un `<a href="https://go.computrabajo.com/…?url=<aviso codificado>">`
 *     que envuelve un `<td class="title_oferta"><strong>título</strong></td>` y dos
 *     `<td class="texto_oferta">`: empresa (con una calificación opcional en un `<span>`) y ubicación.
 *   - El `url=` del tracker lleva la URL pública del aviso:
 *     `https://<pais>.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-<slug>-<ID de 32 hex>`.
 *     De ahí salen `externalId` (el ID) y `source.url` (sin parámetros). Los demás parámetros del
 *     tracker (`ipo`, `idu`, `isd`…) identifican a la persona y no se guardan.
 *
 * No se leen, y devuelven `{ ok: false }`:
 *   - El recordatorio «Volvé a revisar estos trabajos»: sus tarjetas traen los botones «Ver empleo» y
 *     «Postularme», no un link que envuelva la tarjeta.
 *   - El mail de seguimiento de una empresa («¿Te interesa…?»): sin tarjetas.
 *   Cualquier otra estructura también falla cerrado y el email entero va a la cola manual. Lo que el
 *   mail no dice queda null (`countriesAllowed`, modalidad, contrato, fecha: «Hoy» es relativo).
 *
 * El pool (ADR-024, casillas `pool-*`) es otro camino y no se toca.
 */

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function texto(html: string): string {
  return (
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&[a-z]+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
      // \s ya incluye el espacio de no separación (&#160;)
      .replace(/\s+/g, " ")
      .trim()
  );
}

const TRACKER = /^https:\/\/go\.computrabajo\.com\//i;
const AVISO_PATH = /^\/ofertas-de-trabajo\/oferta-de-trabajo-de-[a-z0-9-]+-([0-9A-F]{32})$/;
const AVISO_HOST = /^[a-z]{2}\.computrabajo\.com$/;
const RECORDATORIO = /Volvé a revisar estos trabajos|aún estás a tiempo de enviar tu CV/i;

/** URL pública del aviso e ID, sacados del parámetro `url=` del tracker; null si no es un aviso. */
function avisoDelTracker(href: string): { url: string; id: string } | null {
  const limpio = href.replace(/&amp;/g, "&");
  if (!TRACKER.test(limpio)) return null;
  try {
    const destino = new URL(limpio).searchParams.get("url");
    if (!destino) return null;
    const u = new URL(destino);
    if (u.protocol !== "https:" || !AVISO_HOST.test(u.hostname.toLowerCase())) return null;
    const id = AVISO_PATH.exec(u.pathname)?.[1];
    return id ? { url: `https://${u.hostname.toLowerCase()}${u.pathname}`, id } : null;
  } catch {
    return null;
  }
}

function leerTarjeta(href: string, interior: string): RawJob | string {
  const aviso = avisoDelTracker(href);
  if (!aviso) return "link de la tarjeta que no apunta a un aviso de Computrabajo";

  const titulos = [...interior.matchAll(/<td[^>]*class="title_oferta"[^>]*>([\s\S]*?)<\/td>/gi)];
  if (titulos.length !== 1) return `tarjeta con ${titulos.length} títulos (se espera 1)`;
  const title = texto(/<strong[^>]*>([\s\S]*?)<\/strong>/i.exec(titulos[0]![1]!)?.[1] ?? "");
  if (!title) return "tarjeta sin título";

  const lineas = [...interior.matchAll(/<td[^>]*class="texto_oferta"[^>]*>([\s\S]*?)<\/td>/gi)].map(
    // La calificación de la empresa viene en un <span> dentro de la misma celda
    (m) => texto(m[1]!.replace(/<span[\s\S]*?<\/span>/gi, " ")),
  );
  if (lineas.length !== 2) {
    return `tarjeta con ${lineas.length} líneas de texto (se esperan 2: empresa y ubicación)`;
  }
  const [company, location] = lineas as [string, string];
  if (!company) return "tarjeta sin empresa";

  return {
    source: {
      kind: "email_generic",
      name: "Computrabajo (email)",
      externalId: aviso.id,
      url: aviso.url,
      rawRef: null,
    },
    title,
    companyRaw: company,
    locationRaw: location || null,
    // El mail no dice desde qué países se contrata ni la modalidad
    countriesAllowed: null,
    modality: "desconocida",
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: null,
    postedAt: null,
    tags: [],
    seniority: null,
    lang: null,
  };
}

export const computrabajoParser: EmailParser = {
  name: "computrabajo",
  parse(email: InboundEmailContent): ParseResult {
    const html = email.html;
    if (!html) return { ok: false, reason: "email de Computrabajo sin HTML: cola manual" };
    if (RECORDATORIO.test(html)) {
      return {
        ok: false,
        reason: "recordatorio de Computrabajo, no es una lista de avisos: cola manual",
      };
    }

    const tarjetas = [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)].filter((m) =>
      /class="title_oferta"/i.test(m[2]!),
    );
    const totalTitulos = [...html.matchAll(/class="title_oferta"/gi)].length;
    if (!tarjetas.length) {
      return { ok: false, reason: "email de Computrabajo sin avisos: cola manual" };
    }
    if (totalTitulos !== tarjetas.length) {
      return {
        ok: false,
        reason: "email de Computrabajo con títulos fuera de las tarjetas: cola manual",
      };
    }

    const jobs: RawJob[] = [];
    for (const m of tarjetas) {
      const href = /href="([^"]+)"/i.exec(m[1]!)?.[1] ?? "";
      const job = leerTarjeta(href, m[2]!);
      if (typeof job === "string") return { ok: false, reason: `${job}: cola manual` };
      jobs.push(job);
    }
    return { ok: true, jobs };
  },
};
