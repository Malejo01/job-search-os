import type { Modality, RawJob } from "@job-search-os/pipeline";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser del mail «Bumeran te sugiere» (R11-3), de la casilla de no responder de bumeran.com. Estructura (6 esqueletos
 * de la R8-1, uno distinto: la invitación de una empresa, que no se lee):
 *   - `<title>Bumeran te sugiere</title>`.
 *   - Una tarjeta por aviso: un `<a href="https://delivery.bumeran.com/…">` que envuelve un único
 *     `<h3>` con el título y, después, cuatro `<p><span>` visibles: empresa, ubicación, contrato y
 *     modalidad. Un quinto `<p>` oculto (`display: none`, «Apto discapacidad») no cuenta.
 *   - La línea de antes del título («Nuevo», «Publicado hace 3 días») no se usa: es relativa.
 *
 * Los links son un tracker por persona (`delivery.bumeran.com/…?id=…`) y no traen el id del aviso:
 * no se guardan (`source.url` y `externalId` quedan null) ni se siguen desde el servidor (D-028).
 * Sin URL, el dedup no cruza el mismo aviso entre dos mails: queda como «posible duplicado»
 * (ADR-013), que es visible y reversible.
 *
 * Falla cerrado: sin HTML, sin el título del mail, un `<h3>` fuera de una tarjeta, una tarjeta con
 * otra cantidad de líneas, una modalidad desconocida o una empresa vacía → `{ ok: false }` y el
 * email entero a la cola manual. Lo que el mail no dice queda null (`countriesAllowed` incluido).
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
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

const TRACKER = /^https:\/\/delivery\.bumeran\.com\//i;

const MODALIDAD: Record<string, Modality> = {
  remoto: "remoto",
  híbrido: "hibrido",
  hibrido: "hibrido",
  presencial: "presencial",
};

/** Texto del primer `<span>` de un `<p>`: el segundo (el distintivo de empresa verificada) se ignora. */
function primerSpan(parrafo: string): string | null {
  const m = /<span[^>]*>([\s\S]*?)<\/span>/i.exec(parrafo);
  return m ? texto(m[1]!) : null;
}

type Tarjeta = {
  title: string;
  company: string;
  location: string | null;
  contract: string;
  modality: Modality;
};

function leerTarjeta(href: string, interior: string): Tarjeta | string {
  if (!TRACKER.test(href.replace(/&amp;/g, "&")))
    return "link de la tarjeta fuera del tracker de Bumeran";
  const h3s = [...interior.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  if (h3s.length !== 1) return `tarjeta con ${h3s.length} títulos (se espera 1)`;
  const title = texto(h3s[0]![1]!);
  if (!title) return "tarjeta sin título";

  const despues = interior.slice(h3s[0]!.index! + h3s[0]![0].length);
  const lineas = [...despues.matchAll(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .filter((m) => !/display\s*:\s*none/i.test(m[1] ?? ""))
    .map((m) => primerSpan(m[2]!));
  if (lineas.length !== 4 || lineas.some((l) => l === null)) {
    return `tarjeta con ${lineas.length} líneas visibles (se esperan 4: empresa, ubicación, contrato, modalidad)`;
  }
  const [company, location, contract, modalidad] = lineas as string[];
  if (!company) return "tarjeta sin empresa";
  if (!contract) return "tarjeta sin tipo de contrato";
  const modality = MODALIDAD[modalidad!.toLowerCase()];
  if (!modality) return "tarjeta con una modalidad desconocida";
  return { title, company, location: location || null, contract, modality };
}

export const bumeranParser: EmailParser = {
  name: "bumeran",
  parse(email: InboundEmailContent): ParseResult {
    const html = email.html;
    if (!html) return { ok: false, reason: "email de Bumeran sin HTML: cola manual" };

    const titulo = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    if (!titulo || texto(titulo).toLowerCase() !== "bumeran te sugiere") {
      return { ok: false, reason: "email de Bumeran que no es «Bumeran te sugiere»: cola manual" };
    }

    const tarjetas = [...html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)].filter((m) =>
      /<h3[\s>]/i.test(m[2]!),
    );
    const totalH3 = [...html.matchAll(/<h3[\s>]/gi)].length;
    if (!tarjetas.length) return { ok: false, reason: "email de Bumeran sin avisos: cola manual" };
    if (totalH3 !== tarjetas.length) {
      return {
        ok: false,
        reason: "email de Bumeran con títulos fuera de las tarjetas: cola manual",
      };
    }

    const jobs: RawJob[] = [];
    for (const m of tarjetas) {
      const href = /href="([^"]+)"/i.exec(m[1]!)?.[1] ?? "";
      const card = leerTarjeta(href, m[2]!);
      if (typeof card === "string") return { ok: false, reason: `${card}: cola manual` };
      jobs.push({
        source: {
          kind: "email_generic",
          name: "Bumeran (email)",
          externalId: null,
          url: null,
          rawRef: null,
        },
        title: card.title,
        companyRaw: card.company,
        locationRaw: card.location,
        // El mail no dice desde qué países se contrata
        countriesAllowed: null,
        modality: card.modality,
        contractType: card.contract,
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
      });
    }
    return { ok: true, jobs };
  },
};
