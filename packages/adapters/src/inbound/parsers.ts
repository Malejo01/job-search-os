import type { RawJob } from "@job-search-os/pipeline";
import { getonboardParser } from "./getonboard";
import { linkedinParser } from "./linkedin";

/**
 * Parsers de email por remitente (JS-021 LinkedIn, JS-022 Get on Board y genérico). Contrato:
 * fallan cerrado. Si la estructura no es la esperada devuelven { ok: false } y el email queda en
 * la cola manual (inbound_emails con error); nunca se inventan campos.
 */
export type InboundEmailContent = {
  from: string;
  to: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  receivedAt: Date;
};

export type ParseResult = { ok: true; jobs: RawJob[] } | { ok: false; reason: string };

export type EmailParser = {
  name: "linkedin" | "getonboard" | "generic";
  parse(email: InboundEmailContent): ParseResult;
};

/** Dirección del remitente, sin el nombre visible: "LinkedIn <x@linkedin.com>" → "x@linkedin.com". */
function senderAddress(fromAddress: string): string {
  const addr = fromAddress.toLowerCase();
  return (/<([^>]+)>/.exec(addr)?.[1] ?? addr).trim();
}

/**
 * Remitentes de LinkedIn por su dirección exacta (JS-050). El ruido social (artículos, cursos,
 * invitaciones, "apareciste en búsquedas") llega del mismo dominio que las alertas, así que no
 * se separa por dominio ni por asunto (los de jobs-noreply traen avisos con asuntos variados):
 * se separa por la parte local. Revisado contra los 22 emails de LinkedIn de producción al
 * 2026-09-22, sin excepciones. Un remitente de LinkedIn que no está en ninguna lista sigue el
 * camino de siempre (parser, y si falla, cola manual).
 */
const LINKEDIN_EMPLEO = new Set(["jobalerts-noreply", "jobs-noreply"]);
const LINKEDIN_SOCIAL = new Set(["messages-noreply", "invitations", "notifications-noreply"]);

export function linkedinSenderKind(
  fromAddress: string,
): "empleo" | "social" | "desconocido" | null {
  const [local = "", domain = ""] = senderAddress(fromAddress).split("@");
  if (domain !== "linkedin.com" && !domain.endsWith(".linkedin.com")) return null;
  if (LINKEDIN_EMPLEO.has(local)) return "empleo";
  if (LINKEDIN_SOCIAL.has(local)) return "social";
  return "desconocido";
}

/** Remitente → parser. `generic` es el último recurso y también falla cerrado. */
export function chooseParserName(fromAddress: string): EmailParser["name"] {
  const addr = fromAddress.toLowerCase();
  const domain = (/@([^>\s]+)/.exec(addr)?.[1] ?? addr).trim();
  if (domain.endsWith("linkedin.com")) return "linkedin";
  if (domain.endsWith("getonbrd.com") || domain.endsWith("getonboard.com")) return "getonboard";
  return "generic";
}

/**
 * Registro de parsers implementados. Lo que no tiene parser va a la cola manual.
 *
 * `generic` queda sin registrar a propósito (JS-022): no hay una estructura común que se pueda
 * extraer sin inventar campos (ninguno de los emails reales trae JobPosting en JSON-LD ni
 * microdata), y registrarlo cambiaría `parser = 'none'`, que es lo que cuenta la alarma de
 * volumen "sin parser" de /inbox (JS-038). Cada fuente nueva lleva su parser propio.
 */
export const EMAIL_PARSERS: Partial<Record<EmailParser["name"], EmailParser>> = {
  linkedin: linkedinParser,
  getonboard: getonboardParser,
};
