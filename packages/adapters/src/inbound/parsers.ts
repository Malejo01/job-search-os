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
