import type { Modality, RawJob } from "@job-search-os/pipeline";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser de emails de empleo de LinkedIn (JS-021). Cubre dos formatos, que comparten la misma
 * tarjeta y solo cambian el ancla:
 *   - alertas de empleo → `data-test-id="job-card"`
 *   - recomendaciones ("Amplía tu búsqueda") → `...JOBS_POSTING_SECTION-job-cards"`
 * En ambos, el id está en el link a /jobs/view/<id>/ y hay una línea "Empresa · Ubicación
 * (Modalidad)". Ninguno trae la descripción: `jdText` queda null y la oferta cae en pendiente_jd.
 *
 * Sigue en cola manual el email de "empleos guardados" (`featured-saved-job` /
 * `other-saved-jobs-job-card-N`): son avisos que el usuario ya guardó, entrarían casi todos como
 * duplicado y varias tarjetas vienen sin modalidad. Ver el gap anotado en docs/BACKLOG.md.
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

/**
 * Nombre legible de la fuente: `alerta «AI Engineer»` o `recomendaciones «IA generativa»`.
 * La búsqueda entre comillas angulares está en el asunto (alertas) o en el cuerpo
 * (recomendaciones); sin ella, queda solo el formato.
 */
function nombreFuente(
  formato: "alerta" | "recomendaciones",
  subject: string | null,
  html: string,
): string {
  const busqueda = /«([^»]+)»/.exec(subject ?? "")?.[1] ?? /«([^»<]+)»/.exec(html)?.[1];
  return busqueda ? `${formato} «${busqueda}»` : `${formato} de LinkedIn`;
}

function tarjetaARawJob(card: string, sourceName: string): RawJob | { error: string } {
  const externalId = /\/jobs\/view\/(\d+)/.exec(card)?.[1];
  if (!externalId) return { error: "tarjeta sin id de aviso (/jobs/view/<id>)" };

  const lineas = lineasVisibles(card);
  const iEmpresa = lineas.findIndex((l) => l.includes(" · "));
  if (iEmpresa < 1) return { error: `tarjeta ${externalId} sin línea "Empresa · Ubicación"` };

  // la línea tiene " · " (lo garantiza el findIndex), así que empresa y ubicación no van vacías;
  // si hubiera más de un separador, lo extra es parte de la ubicación
  const [empresa = "", ...resto] = lineas[iEmpresa]!.split(" · ");
  const title = lineas[iEmpresa - 1]!;
  const { locationRaw, modality } = partirUbicacion(resto.join(" · "));

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

    const formato = email.html.includes('data-test-id="job-card"') ? "alerta" : "recomendaciones";
    const tarjetas = email.html
      .split(/data-test-id="(?:job-card|[^"]*JOBS_POSTING_SECTION-job-cards)"/)
      .slice(1)
      // el split corta dentro del <td>: descartamos lo que queda de sus atributos
      .map((c) => c.slice(c.indexOf(">") + 1));
    if (tarjetas.length === 0) {
      return { ok: false, reason: "email de LinkedIn sin tarjetas de aviso: cola manual" };
    }

    const jobs: RawJob[] = [];
    const sourceName = nombreFuente(formato, email.subject, email.html);
    for (const card of tarjetas) {
      const res = tarjetaARawJob(card, sourceName);
      if ("error" in res) return { ok: false, reason: `${res.error}: cola manual` };
      jobs.push(res);
    }
    return { ok: true, jobs };
  },
};
