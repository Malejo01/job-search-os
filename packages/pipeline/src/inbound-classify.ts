import { baseDomain, senderHost } from "./filter-leak";

/**
 * Clasificación de un email entrante al llegar (JS-119). Pura: recibe remitente, asunto y texto,
 * devuelve una categoría y, para las postulaciones de LinkedIn, lo que el email dice del aviso.
 * El contenido es dato, no instrucción: acá solo se lee, y quien decide qué hacer es el código
 * que llama.
 *
 * `seguridad` falla del lado de NO descartar: solo señales fuertes (códigos, reseteos, nuevos
 * inicios de sesión). Un aviso con "verificación" o "security" en el título es `normal`.
 */
export const INBOUND_CATEGORIES = [
  "seguridad",
  "confirmacion_reenvio_gmail",
  "postulacion_enviada",
  "postulacion_vista",
  "normal",
] as const;
export type InboundCategory = (typeof INBOUND_CATEGORIES)[number];

export type LinkedinApplicationInfo = {
  company: string | null;
  title: string | null;
  /** Id numérico del aviso en LinkedIn (`/jobs/view/<id>`), si el cuerpo trae el link. */
  linkedinJobId: string | null;
  /** URL canónica del aviso armada con ese id. */
  linkedinUrl: string | null;
};

export type InboundClassification = {
  category: InboundCategory;
  /** Solo para `postulacion_enviada` y `postulacion_vista`. */
  application: LinkedinApplicationInfo | null;
};

export type ClassifyInput = {
  from: string;
  to?: readonly string[];
  subject: string | null | undefined;
  text?: string | null;
  /**
   * Remitente esperado (fuente de empleo): `seguridad` se decide solo por el asunto, así un
   * aviso con números en el cuerpo no se pierde.
   */
  securityBySubjectOnly?: boolean;
};

/** Texto visible de un HTML, para clasificar cuando el email no trae parte de texto. */
export function htmlToText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h\d)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Dirección del remitente en minúsculas, con o sin nombre visible. */
function senderAddr(from: string): string {
  return (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
}

/** Valores de `inbound_emails.parser` de la clasificación al llegar (nombre único, JS-119). */
export const SECURITY_PARSER = "seguridad";
export const GMAIL_FORWARDING_PARSER = "gmail_reenvio";
export const LINKEDIN_APPLICATION_PARSER = "linkedin_postulacion";

/** Único remitente de la confirmación de reenvío de Gmail. */
export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";
const GMAIL_FORWARDING_SUBJECT =
  /gmail forwarding confirmation|confirmaci[oó]n de reenv[ií]o de gmail/i;

/** Enlace mágico: el link mismo inicia la sesión. */
const MAGIC_LINK =
  /magic link|enlace m[aá]gico|enlace de acceso|(?:sign|log)[- ]?in link|link (?:de|para) (?:acceso|iniciar sesi[oó]n)|iniciar sesi[oó]n con (?:este|el) (?:enlace|link)|sign in with this link/i;

/** Señales fuertes en el asunto. Ninguna es una palabra suelta de un título de aviso. */
const SECURITY_SUBJECT: readonly RegExp[] = [
  /c[oó]digo de (?:verificaci[oó]n|seguridad|acceso|confirmaci[oó]n|un solo uso|inicio de sesi[oó]n)/i,
  // "Security Code Reviewer" es un puesto: el código tiene que ser "tu código" o "código: …/es …"
  /\b(?:your|use|enter|here'?s)\b[^.:]{0,30}\b(?:verification|security|confirmation|login|sign[- ]?in|access|one[- ]time) code\b/i,
  /\b(?:verification|security|confirmation|login|sign[- ]?in|access|one[- ]time) code\s*(?:is\b|:)/i,
  /one[- ]time (?:password|passcode|pin)/i,
  // OTP / 2FA / MFA sueltos son tecnologías de puestos ("MFA Platform Engineer"): con contexto
  /\b(?:your|use|enter|enable|set up|activ\w*|configur\w*|tu|su)\b[^.:]{0,20}\b(?:otp|2fa|mfa)\b/i,
  /\b(?:otp|2fa|mfa)\s+(?:code|token|c[oó]digo)\b|c[oó]digo\s+(?:otp|2fa|mfa)\b/i,
  /two[- ]factor|two[- ]step verification|verificaci[oó]n en dos pasos|autenticaci[oó]n (?:de|en) dos/i,
  /restablec\S*\s+(?:tu|su|la|de)\s+contrase[ñn]a|contrase[ñn]a (?:temporal|restablecida|nueva)/i,
  /recuper\S*\s+(?:tu|su|la)\s+contrase[ñn]a|cambi\S*\s+(?:tu|su|la)\s+contrase[ñn]a/i,
  /(?:reset|change|forgot|recover)\w*\s+(?:your\s+)?password|password (?:reset|recovery|change)/i,
  /nuevo inicio de sesi[oó]n|inicio de sesi[oó]n (?:nuevo|sospechoso|desde)|intento de (?:inicio de sesi[oó]n|acceso)/i,
  /new (?:sign[- ]?in|log[- ]?in)|(?:sign[- ]?in|log[- ]?in) attempt|suspicious (?:sign[- ]?in|log[- ]?in|activity)/i,
  /verif(?:y|ica|ic[aá])\w*\s+(?:your|tu|su|el|la)\s+(?:e-?mail|correo|account|cuenta|identity|identidad)/i,
  /confirm\w*\s+(?:your|tu|su|el|la)\s+(?:e-?mail|correo|account|cuenta)/i,
  MAGIC_LINK,
];

/** En el cuerpo, solo un código explícito al comienzo (los avisos de empleo listan puestos). */
const SECURITY_BODY: readonly RegExp[] = [
  /(?:c[oó]digo de (?:verificaci[oó]n|seguridad|acceso|un solo uso)|(?:verification|security|login|sign[- ]?in|one[- ]time) code)[^\n]{0,20}?(?:\bis\b|\bes\b|:)[^\n]{0,20}\d{4,8}/i,
  /(?:tu|su)\s+c[oó]digo\s+(?:es|:)\s*[:\s]*[A-Z0-9-]{4,10}\b/i,
  /your\s+(?:\w+\s+)?code\s+(?:is|:)\s*[:\s]*[A-Z0-9-]{4,10}\b/i,
  MAGIC_LINK,
];
const BODY_HEAD = 600;

const LINKEDIN_SENT: readonly RegExp[] = [
  /se (?:ha enviado|envi[oó]) tu solicitud (?:a|para|en)\s+(.+)$/i,
  /tu solicitud (?:a|para|en)\s+(.+?)\s+(?:se )?(?:ha )?(?:sido )?(?:enviado|envi[oó])\b/i,
  /your application (?:was|has been) (?:sent|submitted) to\s+(.+)$/i,
];
const LINKEDIN_SENT_NO_COMPANY =
  /se (?:ha enviado|envi[oó]) tu solicitud\s*$|your application was sent\s*$/i;
const LINKEDIN_VIEWED: readonly RegExp[] = [
  /^(.+?)\s+(?:ha visto|vio) tu solicitud/i,
  /your application was viewed by\s+(.+)$/i,
  /^(.+?)\s+viewed your application/i,
];
const LINKEDIN_VIEWED_NO_COMPANY =
  /(?:ha visto|vio) tu solicitud\s*$|your application was viewed\s*$/i;

function cleanCompany(raw: string | undefined): string | null {
  const c = (raw ?? "").trim().replace(/[\s.!:;,]+$/, "");
  return c && c.length <= 120 ? c : null;
}

function firstMatch(patterns: readonly RegExp[], s: string): RegExpExecArray | null {
  for (const p of patterns) {
    const m = p.exec(s);
    if (m) return m;
  }
  return null;
}

/** El puesto, solo si es la línea siguiente al encabezado que repite el asunto. */
function titleAfterHeading(
  text: string | null | undefined,
  patterns: readonly RegExp[],
  company: string | null,
): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const i = lines.findIndex((l) => l && firstMatch(patterns, l));
  if (i < 0) return null;
  const next = lines.slice(i + 1).find((l) => l.length > 0);
  if (!next || next.length > 120 || /https?:\/\/|·|\|/.test(next)) return null;
  if (company && next.toLowerCase() === company.toLowerCase()) return null;
  return next;
}

function linkedinJob(text: string | null | undefined): { id: string | null; url: string | null } {
  const id = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d{8,})(?!\d)/i.exec(text ?? "")?.[1] ?? null;
  return { id, url: id ? `https://www.linkedin.com/jobs/view/${id}/` : null };
}

export function classifyInbound(input: ClassifyInput): InboundClassification {
  const subject = (input.subject ?? "").trim();
  const text = input.text ?? null;
  const addr = senderAddr(input.from);
  const normal: InboundClassification = { category: "normal", application: null };

  // 1. Confirmación de reenvío de Gmail: antes de seguridad, porque su cuerpo trae un código
  if (addr === GMAIL_FORWARDING_SENDER && GMAIL_FORWARDING_SUBJECT.test(subject)) {
    return { category: "confirmacion_reenvio_gmail", application: null };
  }

  // 2. Seguridad, de cualquier remitente
  const head = input.securityBySubjectOnly ? "" : (text ?? "").slice(0, BODY_HEAD);
  if (SECURITY_SUBJECT.some((p) => p.test(subject)) || SECURITY_BODY.some((p) => p.test(head))) {
    return { category: "seguridad", application: null };
  }

  // 3. Postulaciones de LinkedIn: el remitente tiene que ser del dominio de LinkedIn
  const host = senderHost(input.from);
  if (!host || baseDomain(host) !== "linkedin.com") return normal;

  const viewed = firstMatch(LINKEDIN_VIEWED, subject);
  const sent = viewed ? null : firstMatch(LINKEDIN_SENT, subject);
  const isViewed = Boolean(viewed) || LINKEDIN_VIEWED_NO_COMPANY.test(subject);
  const isSent = Boolean(sent) || LINKEDIN_SENT_NO_COMPANY.test(subject);
  if (!isViewed && !isSent) return normal;

  const company = cleanCompany((viewed ?? sent)?.[1]);
  const job = linkedinJob(text);
  return {
    category: isViewed ? "postulacion_vista" : "postulacion_enviada",
    application: {
      company,
      title: titleAfterHeading(text, isViewed ? LINKEDIN_VIEWED : LINKEDIN_SENT, company),
      linkedinJobId: job.id,
      linkedinUrl: job.url,
    },
  };
}

/**
 * Enmascara lo que en un asunto de seguridad puede ser el código: secuencias de 4 o más dígitos
 * (también separadas por espacios o guiones) y tokens alfanuméricos de 6 o más con letras y
 * dígitos mezclados.
 */
export function maskDigits(s: string): string {
  return s
    .replace(/\d(?:[\s-]?\d){3,}/g, "•••")
    .replace(/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/g, "•••")
    .replace(/\b\d{3}[\s-]\d{3}\b/g, "•••");
}

/**
 * Cuenta de Gmail que pidió el reenvío, si el cuerpo la nombra ("x@… has requested to
 * automatically forward…" / "x@… ha solicitado…"). Null si no aparece: no se infiere de otro
 * lado. Solo lee texto.
 */
export function gmailForwardRequester(
  text: string | null | undefined,
  html: string | null | undefined,
): string | null {
  const re =
    /([A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})\s*\)?\s+(?:has requested|ha solicitado|solicit[oó])/i;
  for (const source of [text ?? "", htmlToText(html)]) {
    const m = re.exec(source);
    if (m) return m[1]!.toLowerCase();
  }
  return null;
}

/** Únicos hosts a los que puede apuntar el link de confirmación. */
export const GMAIL_CONFIRM_HOSTS: ReadonlySet<string> = new Set([
  "mail.google.com",
  "mail-settings.google.com",
]);
const GMAIL_LINK_HOSTS = GMAIL_CONFIRM_HOSTS;

/**
 * Primer link `https` cuyo host sea exactamente mail.google.com o mail-settings.google.com. Sin
 * subdominios parecidos, sin `@` ni puerto en la autoridad. No abre nada: solo lee el texto.
 */
export function gmailConfirmLink(
  text: string | null | undefined,
  html: string | null | undefined,
): string | null {
  const candidates = [text ?? "", (html ?? "").replace(/&amp;/gi, "&")];
  for (const source of candidates) {
    for (const m of source.matchAll(/https:\/\/[^\s"'<>)\]]+/gi)) {
      const link = m[0].replace(/[.,;]+$/, "");
      const authority = link.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
      if (authority.includes("@") || authority.includes(":")) continue;
      if (!GMAIL_LINK_HOSTS.has(authority.toLowerCase())) continue;
      try {
        const url = new URL(link);
        if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
        if (!GMAIL_LINK_HOSTS.has(url.hostname)) continue;
      } catch {
        continue;
      }
      return link;
    }
  }
  return null;
}
