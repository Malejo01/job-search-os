import { countriesMentioned, foldText, type Modality, type RawJob } from "@job-search-os/pipeline";
import type { EmailParser, InboundEmailContent, ParseResult } from "./parsers";

/**
 * Parser de Eightfold: el email "This job is a match" que manda la plataforma de empleo de la
 * empresa (una por tenant: `<tenant>.eightfold.ai`). Estructura descrita por la persona usuaria;
 * está por validar contra un .eml real:
 *   - asunto "This job is a match";
 *   - por aviso, una tarjeta con el título (un `<h1>`–`<h3>`), la ubicación ("Buenos Aires,Argentina",
 *     sin espacio tras la coma), la sección "Relevant Skills" y el botón "Apply Now";
 *   - el botón apunta a `https://<tenant>.eightfold.ai/careers/apply?pid=<n>&domain=<dominio>`.
 *
 * Reglas de extracción:
 *   - externalId: `eightfold:<tenant>:<pid>`, así el mismo aviso de dos emails es una sola oferta;
 *   - url: la de postulación con solo `pid` y `domain` (todo lo demás es tracking);
 *   - empresa: el parámetro `domain` sin el sufijo público y capitalizado ("empresa-ficticia.example"
 *     → "Empresa Ficticia"); sin `domain`, el tenant del subdominio; sin ninguno, falla cerrado;
 *   - países: solo si la ubicación nombra exactamente uno de los de la región; si no, null;
 *   - skills: la lista de "Relevant Skills" → tags. Sin esa sección, tags vacías;
 *   - jdText null (→ pendiente_jd) y modalidad "desconocida" salvo que la ubicación diga
 *     remoto/híbrido.
 *
 * Falla cerrado: sin HTML, asunto que no es de un aviso compatible, tarjeta sin título, sin link de
 * postulación o sin pid, link que no es de Eightfold, skills con aspecto de prosa. Si una tarjeta
 * falla, falla el email entero (nunca extracción parcial). Solo se lee el email: el servidor no
 * abre el link ni consulta a Eightfold (D-028).
 *
 * Límites conocidos:
 *   - la empresa sale del parámetro `domain` del link y no se contrasta con el tenant: es un dato
 *     del email, igual que el título (el tenant de una plataforma compartida puede no ser la empresa);
 *   - cómo se leen la ubicación (primer texto tras el título) y las skills (textos tras "Relevant
 *     Skills") está por validar con el .eml real;
 *   - tope de 500 KB de HTML y de 200 caracteres de título.
 */

const ENTIDADES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// Relleno invisible de los emails: espacio de ancho cero, CGJ y guion suave
const INVISIBLES = new RegExp(
  `[${[0x200b, 0x034f, 0x00ad].map((c) => String.fromCharCode(c)).join("")}]`,
  "g",
);

const decodificar = (s: string) =>
  s.replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTIDADES[e.toLowerCase()] ?? e).replace(INVISIBLES, "");

const texto = (html: string) =>
  decodificar(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** Fragmentos de texto de un tramo de HTML, uno por nodo, sin vacíos. */
function fragmentos(html: string): string[] {
  return decodificar(
    html.replace(/<!--[\s\S]*?-->|<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "\n"),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** País de la ubicación si nombra exactamente uno; null si ninguno o más de uno. */
function paisDe(ubicacion: string): string[] | null {
  const encontrados = countriesMentioned(foldText(ubicacion));
  return encontrados.length === 1 ? encontrados : null;
}

function modalidadDe(ubicacion: string | null): Modality {
  const t = foldText(ubicacion ?? "");
  if (/(?<![a-z])(remoto|remota|remote)(?![a-z])/.test(t)) return "remoto";
  if (/(?<![a-z])(hibrido|hibrida|hybrid)(?![a-z])/.test(t)) return "hibrido";
  return "desconocida";
}

const SEGUNDO_NIVEL = new Set(["com", "co", "org", "net", "gov", "edu", "ac"]);

function embellecer(label: string): string | null {
  const palabras = label.split(/[-_]+/).filter(Boolean);
  if (!palabras.length) return null;
  return palabras.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
}

/**
 * Nombre de empresa a partir de un dominio: la etiqueta a la izquierda del sufijo público
 * ("careers.empresa-sur.com.ar" → "Empresa Sur"). null si no queda ninguna.
 */
export function companyFromDomain(domain: string): string | null {
  const labels = domain
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (!labels.length) return null;
  if (labels.length === 1) return embellecer(labels[0]!);
  const [sld, tld] = labels.slice(-2);
  const sufijo = tld!.length === 2 && SEGUNDO_NIVEL.has(sld!) ? 2 : 1;
  const resto = labels.slice(0, -sufijo);
  return resto.length ? embellecer(resto[resto.length - 1]!) : null;
}

type Link = { tenant: string; pid: string; domain: string | null; url: string };

/** Link de postulación `https://<tenant>.eightfold.ai/careers/apply?pid=..&domain=..`, o su motivo de fallo. */
function leerLink(href: string): { ok: true; link: Link } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(decodificar(href).trim());
  } catch {
    return { ok: false, reason: "link de postulación ilegible" };
  }
  const tenant = /^([a-z0-9][a-z0-9-]*)\.eightfold\.ai$/.exec(url.hostname.toLowerCase())?.[1];
  if (
    url.protocol !== "https:" ||
    !tenant ||
    url.pathname.replace(/\/+$/, "") !== "/careers/apply"
  ) {
    return { ok: false, reason: "el botón de postulación no es un link de Eightfold esperado" };
  }
  const pid = url.searchParams.get("pid");
  if (!pid || !/^\d{1,20}$/.test(pid)) {
    return { ok: false, reason: "link de postulación sin pid válido" };
  }
  const rawDomain = url.searchParams.get("domain")?.trim().toLowerCase() || null;
  if (rawDomain && !/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(rawDomain)) {
    return { ok: false, reason: "link de postulación con un domain ilegible" };
  }
  const query = `pid=${pid}${rawDomain ? `&domain=${rawDomain}` : ""}`;
  return {
    ok: true,
    link: {
      tenant,
      pid,
      domain: rawDomain,
      url: `https://${tenant}.eightfold.ai/careers/apply?${query}`,
    },
  };
}

const RELEVANT_SKILLS = /^relevant skills:?$/i;
const APPLY_NOW = /^apply now$/i;
const MAX_SKILL = 60;
const MAX_SKILLS = 40;
const MAX_UBICACION = 120;
const MAX_TITULO = 200;
const MAX_HTML = 500 * 1024;
/** Rótulo del email que no es un título: "This job is a match", "is a match". */
const ROTULO_MATCH = /^(?:this jobs? |these jobs |jobs? )?(?:is|are) an? match(?:es)?[.!:]?$/i;

export const eightfoldParser: EmailParser = {
  name: "eightfold",
  parse(email: InboundEmailContent): ParseResult {
    const html = email.html;
    if (!html) return { ok: false, reason: "email de Eightfold sin HTML: cola manual" };
    // Tope antes de cualquier regex: un cuerpo enorme no es un aviso y no debe colgar el webhook
    if (html.length > MAX_HTML) {
      return { ok: false, reason: "email de Eightfold demasiado grande: cola manual" };
    }

    // El asunto confirma que es un aviso compatible ("This job is a match")
    const asunto = texto(email.subject ?? "");
    if (!/\bmatch/i.test(asunto)) {
      return {
        ok: false,
        reason: "email de Eightfold con un asunto que no es de aviso compatible: cola manual",
      };
    }

    // Un botón "Apply Now" por aviso. El segundo botón al mismo pid (imagen, texto) no cuenta.
    const botones = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter((m) =>
      APPLY_NOW.test(texto(m[2]!)),
    );
    if (!botones.length) {
      return { ok: false, reason: "email de Eightfold sin botón de postulación: cola manual" };
    }

    const jobs: RawJob[] = [];
    const vistos = new Set<string>();
    let desde = 0;
    for (const boton of botones) {
      const href = /href\s*=\s*"([^"]*)"/i.exec(boton[1]!)?.[1];
      const leido = href ? leerLink(href) : null;
      if (!leido) return { ok: false, reason: "botón de postulación sin link: cola manual" };
      if (!leido.ok) return { ok: false, reason: `${leido.reason}: cola manual` };
      const { link } = leido;
      const clave = `${link.tenant}:${link.pid}`;
      const fin = boton.index! + boton[0].length;
      if (vistos.has(clave)) {
        desde = fin;
        continue;
      }
      vistos.add(clave);

      // Tarjeta del aviso: desde el botón anterior hasta este
      const tarjeta = html.slice(desde, boton.index!);
      desde = fin;
      const job = leerTarjeta(tarjeta, link);
      if (!job.ok) return { ok: false, reason: `${job.reason}: cola manual` };
      jobs.push(job.job);
    }
    return { ok: true, jobs };
  },
};

function leerTarjeta(
  tarjeta: string,
  link: Link,
): { ok: true; job: RawJob } | { ok: false; reason: string } {
  // Título: el último encabezado antes de "Relevant Skills" (o del botón) que no sea un rótulo
  const encabezados = [...tarjeta.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => ({ fin: m.index! + m[0].length, texto: texto(m[1]!) }))
    .filter((h) => h.texto);
  const iSkills = encabezados.findIndex((h) => RELEVANT_SKILLS.test(h.texto));
  const candidatos = (iSkills >= 0 ? encabezados.slice(0, iSkills) : encabezados).filter(
    (h) => !ROTULO_MATCH.test(foldText(h.texto)),
  );
  const titulo = candidatos[candidatos.length - 1];
  if (!titulo) return { ok: false, reason: `aviso de Eightfold (pid ${link.pid}) sin título` };
  if (titulo.texto.length > MAX_TITULO) {
    return {
      ok: false,
      reason: `aviso de Eightfold (pid ${link.pid}) con un título demasiado largo`,
    };
  }

  // Después del título: ubicación, y si está, la sección de skills hasta el botón
  const resto = fragmentos(tarjeta.slice(titulo.fin));
  const iRel = resto.findIndex((f) => RELEVANT_SKILLS.test(f));
  const antes = iRel >= 0 ? resto.slice(0, iRel) : resto;
  const ubicacion = antes[0] ?? null;
  if (ubicacion && ubicacion.length > MAX_UBICACION) {
    return { ok: false, reason: "ubicación de Eightfold con forma inesperada" };
  }
  const crudas = iRel >= 0 ? resto.slice(iRel + 1) : [];
  if (crudas.some((s) => s.length > MAX_SKILL)) {
    return { ok: false, reason: "lista de Relevant Skills con forma inesperada" };
  }
  const tags = [...new Set(crudas)].slice(0, MAX_SKILLS);

  const empresa = (link.domain ? companyFromDomain(link.domain) : null) ?? embellecer(link.tenant);
  if (!empresa) return { ok: false, reason: "aviso de Eightfold sin empresa" };

  return {
    ok: true,
    job: {
      source: {
        kind: "email_generic",
        name: "Eightfold (email)",
        externalId: `eightfold:${link.tenant}:${link.pid}`,
        url: link.url,
        rawRef: null,
      },
      title: titulo.texto,
      companyRaw: empresa,
      locationRaw: ubicacion,
      // El email no dice desde qué países se contrata: solo se afirma si la ubicación nombra uno
      countriesAllowed: ubicacion ? paisDe(ubicacion) : null,
      modality: modalidadDe(ubicacion),
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
      tags,
      seniority: null,
      lang: null,
    },
  };
}
