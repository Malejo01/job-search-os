import type { RawJob } from "@job-search-os/pipeline";

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

/** Registro de parsers implementados. Vacío hasta JS-021/022: todo va a la cola manual. */
export const EMAIL_PARSERS: Partial<Record<EmailParser["name"], EmailParser>> = {};
