import { gunzipSync } from "node:zlib";
import type { Modality, RawJob } from "@job-search-os/pipeline";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser de Indeed (JS-047): el email de "empleo compatible" que manda
 * donotreply@match.indeed.com. Un aviso por email, con el asunto "<Título> en <Empresa>".
 * Estructura (5 de 5 emails reales, 2026-09-17..22):
 *   - `<h2><a class="strong-text-link">Título</a></h2>`, y después dos `<p>`: empresa y ubicación.
 *   - Bloques opcionales `<h3 class="h3-md">Sueldo</h3>` y `<h3 class="h3-md">Tipo de empleo</h3>`,
 *     cada uno con uno o más `role="listitem"`.
 *   - "Vista previa de la descripción del puesto": recortada ("…"), no se usa como JD.
 *
 * Los links van envueltos en `cts.indeed.com/v3/<token>`, donde el token es gzip en base64. El id
 * del aviso (`jk`) se saca decodificándolo acá mismo, sin navegar a ningún lado. La URL se arma
 * como `https://<host>/viewjob?jk=<jk>`, que `canonicalUrl` reduce al `jk`.
 *
 * Falla cerrado: sin HTML, sin título, con más de un aviso, sin `jk`, o con un asunto que no es
 * "<Título> en <Empresa>" → `{ ok: false }` y el email entero a la cola manual. Lo que el email no
 * dice queda null. El sueldo viene sin moneda ("$1.045,00 - $3.232,58 por mes"): no se carga como
 * USD, va como nota.
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
      .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
      // Relleno invisible de los emails de Indeed (espacio de ancho cero, CGJ, guion suave)
      .replace(/\u200b|\u034f|\u00ad/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Host y jk de un link de Indeed: directo (`?jk=`) o envuelto en el tracker cts.indeed.com/v3. */
export function jobKeyFromTracker(href: string): { host: string; jk: string } | null {
  const url = href.replace(/&amp;/g, "&");
  const found = (s: string) => {
    const m = /https?:\/\/((?:[a-z]{2}\.)?indeed\.com)\/[^\s"'\\]*?[?&]jk=([0-9a-f]{16})/i.exec(s);
    return m ? { host: m[1]!.toLowerCase(), jk: m[2]!.toLowerCase() } : null;
  };
  const direct = found(url);
  if (direct) return direct;
  const token = /^https:\/\/cts\.indeed\.com\/v3\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!token) return null;
  try {
    return found(gunzipSync(Buffer.from(token, "base64url")).toString("utf8"));
  } catch {
    return null;
  }
}

/** Valores de un bloque `<h3>Nombre</h3>` seguido de sus `role="listitem"`; null si no está. */
function bloque(html: string, nombre: string): string[] | null {
  const i = html.search(new RegExp(`<h3[^>]*>\\s*${nombre}\\s*</h3>`));
  if (i < 0) return null;
  // El bloque termina en el próximo <h3> o en el separador entre secciones, lo que venga primero:
  // en los emails reales "Sueldo" y "Tipo de empleo" comparten sección, sin separador entre ellos
  const resto = html.slice(i + 1);
  const cortes = [resto.search(/<h3[\s>]/), resto.indexOf('aria-hidden="true">&nbsp;')].filter(
    (n) => n >= 0,
  );
  const tramo = cortes.length ? resto.slice(0, Math.min(...cortes)) : resto;
  const items = [...tramo.matchAll(/role="listitem"[^>]*>([\s\S]*?)<\/table>/g)]
    .map((m) => texto(m[1]!))
    .filter(Boolean);
  return items;
}

const MODALIDAD: Record<string, Modality> = { "desde casa": "remoto" };

export const indeedParser: EmailParser = {
  name: "indeed",
  parse(email: InboundEmailContent): ParseResult {
    const html = email.html;
    if (!html) return { ok: false, reason: "email de Indeed sin HTML: cola manual" };

    const titulos = [...html.matchAll(/<h2[^>]*>\s*<a([^>]*)>([\s\S]*?)<\/a>\s*<\/h2>/g)];
    if (titulos.length !== 1) {
      return {
        ok: false,
        reason: `email de Indeed con ${titulos.length} avisos (se espera 1): cola manual`,
      };
    }
    const [h2, attrs, tituloHtml] = titulos[0]!;
    const title = texto(tituloHtml!);
    const href = /href="([^"]+)"/.exec(attrs!)?.[1];
    const key = href ? jobKeyFromTracker(href) : null;
    if (!title) return { ok: false, reason: "aviso de Indeed sin título: cola manual" };
    if (!key) return { ok: false, reason: "aviso de Indeed sin id del aviso (jk): cola manual" };

    // Empresa y ubicación: los dos primeros <p> después del título
    const despues = html.slice(titulos[0]!.index! + h2!.length);
    const [company = "", locationRaw = ""] = [...despues.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .slice(0, 2)
      .map((m) => texto(m[1]!));
    if (!company) return { ok: false, reason: "aviso de Indeed sin empresa: cola manual" };

    // El asunto confirma la estructura: "<Título> en <Empresa>" (con o sin prefijo de reenvío)
    const asunto = texto(email.subject ?? "").replace(/^(?:(?:fwd?|rv|re)\s*:\s*)+/i, "");
    if (asunto !== `${title} en ${company}`) {
      return {
        ok: false,
        reason: "email de Indeed con un asunto que no es «título en empresa»: cola manual",
      };
    }

    const tipos = bloque(despues, "Tipo de empleo");
    const sueldo = bloque(despues, "Sueldo");
    const job: RawJob = {
      source: {
        kind: "email_generic",
        name: "Indeed (email)",
        externalId: key.jk,
        url: `https://${key.host}/viewjob?jk=${key.jk}`,
        rawRef: null,
      },
      title,
      companyRaw: company,
      locationRaw: locationRaw || null,
      // El email no dice desde qué países se contrata
      countriesAllowed: null,
      modality: MODALIDAD[locationRaw.toLowerCase()] ?? "desconocida",
      contractType: tipos?.length ? tipos.join(", ") : null,
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      salaryNote: sueldo?.length
        ? `Sueldo según Indeed: ${sueldo.join(", ")} (moneda no indicada)`
        : null,
      weeklyHours: null,
      candidatesCount: null,
      badges: [],
      jdText: null,
      postedAt: null,
      tags: [],
      seniority: null,
      lang: null,
    };
    return { ok: true, jobs: [job] };
  },
};
