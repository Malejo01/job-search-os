import type { Modality, RawJob } from "@job-search-os/pipeline";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser de alertas de empleo de LinkedIn (JS-021). Cada aviso viene en una tarjeta marcada con
 * `data-test-id="job-card"`, con el id en el link a /jobs/view/<id>/ y una línea
 * "Empresa · Ubicación (Modalidad)". La alerta NO trae la descripción: `jdText` queda null y la
 * oferta cae en pendiente_jd.
 *
 * Falla cerrado: si el HTML no tiene tarjetas, o si una tarjeta no se entiende, devuelve
 * `{ ok: false }` y el email entero va a la cola manual. Nunca se extrae a medias ni se
 * completan campos que el email no trae (países, salario, candidatos, fecha).
 */

/** Textos que LinkedIn muestra como badge. Lo que no está acá se ignora (pie del email, etc.). */
const BADGES = [
  "En busca de personal",
  "Solicitud sencilla",
  "Crecimiento rápido",
  "Contratación inmediata",
];

const MODALIDADES: Record<string, Modality> = {
  "en remoto": "remoto",
  remoto: "remoto",
  híbrido: "hibrido",
  hibrido: "hibrido",
  semipresencial: "hibrido",
  presencial: "presencial",
};

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&middot;": "·",
};

function decodificar(texto: string): string {
  return texto
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto visible de un fragmento de HTML, como lista de líneas no vacías. */
function lineasVisibles(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .split("\n")
    .map(decodificar)
    .filter(Boolean);
}

/** "Argentina (En remoto)" → { locationRaw: "Argentina", modality: "remoto" } */
function partirUbicacion(texto: string): { locationRaw: string; modality: Modality } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(texto);
  if (!m) return { locationRaw: texto, modality: "desconocida" };
  return {
    locationRaw: m[1]!.trim(),
    modality: MODALIDADES[m[2]!.trim().toLowerCase()] ?? "desconocida",
  };
}

/** `«AI Engineer»: ...` → `alerta «AI Engineer»`; sin alerta en el asunto, nombre genérico. */
function nombreFuente(subject: string | null): string {
  const alerta = subject ? /«([^»]+)»/.exec(subject)?.[1] : null;
  return alerta ? `alerta «${alerta}»` : "alerta de LinkedIn";
}

function tarjetaARawJob(card: string, sourceName: string): RawJob | { error: string } {
  const externalId = /\/jobs\/view\/(\d+)/.exec(card)?.[1];
  if (!externalId) return { error: "tarjeta sin id de aviso (/jobs/view/<id>)" };

  const lineas = lineasVisibles(card);
  const iEmpresa = lineas.findIndex((l) => l.includes(" · "));
  if (iEmpresa < 1) return { error: `tarjeta ${externalId} sin línea "Empresa · Ubicación"` };

  const [empresa, ubicacion] = lineas[iEmpresa]!.split(" · ");
  const title = lineas[iEmpresa - 1]!;
  if (!empresa?.trim() || !ubicacion?.trim() || !title) {
    return { error: `tarjeta ${externalId} sin empresa, ubicación o título` };
  }
  const { locationRaw, modality } = partirUbicacion(ubicacion);

  return {
    source: {
      kind: "email_linkedin",
      name: sourceName,
      externalId,
      url: `https://www.linkedin.com/jobs/view/${externalId}/`,
      rawRef: null,
    },
    title,
    companyRaw: empresa.trim(),
    locationRaw: locationRaw || null,
    // La alerta no dice desde qué países se puede postular: null (desconocido) para que el
    // prefiltro marque riesgo de ubicación en vez de asumir "cualquier país".
    countriesAllowed: null,
    modality,
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: lineas.slice(iEmpresa + 1).filter((l) => BADGES.includes(l)),
    jdText: null,
    postedAt: null,
    tags: [],
    seniority: null,
    lang: null,
  };
}

export const linkedinParser: EmailParser = {
  name: "linkedin",
  parse(email: InboundEmailContent): ParseResult {
    if (!email.html) return { ok: false, reason: "email de LinkedIn sin HTML: cola manual" };

    const tarjetas = email.html
      .split(/data-test-id="job-card"/)
      .slice(1)
      // el split corta dentro del <td>: descartamos lo que queda de sus atributos
      .map((c) => c.slice(c.indexOf(">") + 1));
    if (tarjetas.length === 0) {
      return { ok: false, reason: "email de LinkedIn sin tarjetas de aviso: cola manual" };
    }

    const jobs: RawJob[] = [];
    const sourceName = nombreFuente(email.subject);
    for (const card of tarjetas) {
      const res = tarjetaARawJob(card, sourceName);
      if ("error" in res) return { ok: false, reason: `${res.error}: cola manual` };
      jobs.push(res);
    }
    return { ok: true, jobs };
  },
};
