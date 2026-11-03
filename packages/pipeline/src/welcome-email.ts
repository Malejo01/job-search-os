import { PRODUCT_NAME } from "./product";
import { brandedEmailHtml, textToEmailHtml } from "./email-layout";
import { formatNoticeDate } from "./plan-expiry-notice";
import { BETA_PLAN } from "./plans";

/**
 * Email de bienvenida al activar el plan de la beta (C8-7). Puro: la web decide cuándo mandarlo y
 * el adapter lo manda. Una sola vez por activación: solo cuando el plan pasa de no vigente a vigente
 * (renovar un plan que sigue vigente, o un doble clic del admin, no manda otro).
 */
export function isPlanActivation(
  previous: { plan: string; planUntil: Date | null },
  now: Date,
): boolean {
  if (previous.plan !== BETA_PLAN) return true;
  return !previous.planUntil || previous.planUntil.getTime() <= now.getTime();
}

export type WelcomeEmailInput = {
  /** Nombre de la persona; puede venir vacío. */
  displayName: string;
  until: Date;
  /** El acceso viene de la beca (primer mes gratis). */
  becado: boolean;
  /** Origen público de la app (SITE_URL), sin barra final. */
  appUrl: string;
  /** Email de contacto ya validado; null si no hay. */
  contactEmail: string | null;
  /** El chat «Armá tu CV» está abierto para todas las personas (`CV_CHAT_ENABLED=all`). */
  cvEnabled: boolean;
};

function firstName(displayName: string): string {
  return (displayName.trim().split(/\s+/)[0] ?? "").slice(0, 40);
}

/**
 * Qué hacer primero (los pasos de «Empezá acá», C8-5), cuándo vence y cómo pedir ayuda. Sin precio, sin
 * promesas y sin datos de nadie más. Texto simple y el mismo contenido con el encabezado de marca.
 */
export function buildWelcomeEmail(input: WelcomeEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const name = firstName(input.displayName);
  const date = formatNoticeDate(input.until);
  const app = input.appUrl.replace(/\/+$/, "");
  const steps = [
    `Completá tu perfil: contanos qué hiciste y qué sabés hacer. Con eso leemos cada oferta.\n${app}/settings/perfil`,
    `Elegí tus áreas dentro de tu carrera (si te sirven todas, dejalas todas).\n${app}/settings#puesto`,
    `Pegá una oferta que te interese, o esperá: todos los días sumamos ofertas de tu carrera.\n${app}/jobs/new`,
    ...(input.cvEnabled
      ? [`Armá tu CV respondiendo preguntas simples. Lo revisás antes de usarlo.\n${app}/cv/armar`]
      : []),
  ];

  const lines: string[] = [];
  lines.push(name ? `Hola ${name}:` : "Hola:");
  lines.push("");
  lines.push(`Ya tenés tu lugar en la Beta de ${PRODUCT_NAME}. Gracias por sumarte.`);
  lines.push("");
  lines.push("Para empezar, en este orden:");
  lines.push("");
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s}`);
    lines.push("");
  });
  lines.push(
    input.becado
      ? `Tu mes de beca llega hasta el ${date}. Unos días antes te avisamos por email.`
      : `Tu acceso llega hasta el ${date}. Unos días antes te avisamos por email.`,
  );
  lines.push("");
  lines.push(
    "¿Dudas o algo que no anda? Adentro de la app tocá «Contanos qué pasó» o mirá las preguntas frecuentes:",
  );
  lines.push(`${app}/ayuda`);
  if (input.contactEmail) {
    lines.push("");
    lines.push(`También podés escribirnos a ${input.contactEmail}.`);
  }
  lines.push("");
  lines.push("La decisión es siempre tuya: nunca postulamos por vos.");
  const text = lines.join("\n");
  return {
    subject: `Te damos la bienvenida a la Beta de ${PRODUCT_NAME}`,
    text,
    html: brandedEmailHtml({
      bodyHtml: textToEmailHtml(text),
      preheader: "Qué hacer primero y cómo pedir ayuda",
    }),
  };
}
