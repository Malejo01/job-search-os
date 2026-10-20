import { buildMailto, parseContactEmail } from "@job-search-os/pipeline";

/**
 * Contacto de la vitrina (ronda 72). Solo para el servidor: lee `CONTACT_EMAIL`, que no va en el
 * repo. Las páginas son ISR: el valor queda fijo en el HTML hasta la próxima regeneración.
 */
export type ContactLink = { email: string; href: string };

/** El email de contacto, o `null` si la variable falta o no tiene formato de email. */
export function contactEmail(): string | null {
  return parseContactEmail(process.env.CONTACT_EMAIL);
}

/** `mailto:` con el asunto codificado, o `null` si no hay email de contacto. */
export function contactMailto(subject: string): string | null {
  const email = contactEmail();
  return email ? buildMailto(email, subject) : null;
}

/** Email y link listos para pasar por prop a un componente de cliente o de presentación. */
export function contactLink(subject: string): ContactLink | null {
  const email = contactEmail();
  return email ? { email, href: buildMailto(email, subject) } : null;
}
