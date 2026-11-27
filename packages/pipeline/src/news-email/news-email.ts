/**
 * Email de novedades (R32-09). Puro: sin I/O ni reloj. Como mucho uno por semana por persona, con las ofertas nuevas
 * de su carrera, y solo si las hay. El envío, la lectura de la base y la firma del enlace de baja son de
 * `packages/adapters/src/news`; acá solo se decide a quién y qué dice.
 *
 * - Detrás de `NEWS_EMAIL` (apagada por defecto; `testers` o `all`, el patrón de `CV_COACH`).
 * - La baja gana siempre: con `news_email` apagado no sale nada, haya o no ofertas.
 * - Sin ofertas nuevas no se manda nada, y un envío no repite lo que el anterior ya dijo.
 * - El asunto es neutro (sin números, carreras ni títulos): la vista previa de un buzón no delata una búsqueda.
 * - Sellos y textos, los de la R30 (`sealWords` y `aclaracion` los pone la web desde `textos-rediseno.ts`). El
 *   puntaje va con coma y un decimal, el mismo que dice el sello. Nada promete trabajo ni postula por la persona.
 * - Lo que viene de un aviso (título, empresa) se escapa en el HTML y nunca se usa como enlace.
 */
import { brandedEmailHtml, textToEmailHtml } from "../email-layout";
import { PRODUCT_NAME } from "../product";
import { isProfileAgentTester } from "../profile-agent/flag";
import { formatAffinityScore, sealLevel } from "../score-display";

export type NewsEmailMode = "off" | "testers" | "all";

/** `NEWS_EMAIL`: cualquier valor que no sea `testers` o `all` es apagado. */
export function newsEmailMode(env: Record<string, string | undefined>): NewsEmailMode {
  const v = env.NEWS_EMAIL?.trim().toLowerCase();
  return v === "testers" || v === "all" ? v : "off";
}

/** ¿Puede esta persona recibir el email? `testers` usa la misma lista que el agente de perfil. */
export function newsEmailAllowed(
  env: Record<string, string | undefined>,
  email: string | null | undefined,
): boolean {
  const mode = newsEmailMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  return isProfileAgentTester(env, email);
}

/** Días mínimos entre dos emails de la misma persona: «como mucho semanal», con un día de margen para el cron. */
export const NEWS_MIN_DAYS_BETWEEN = 6;
/** Hasta cuántos días atrás se mira cuando no hay un envío reciente. */
export const NEWS_WINDOW_DAYS = 7;
/** Cuántas ofertas lista el email; las demás se resumen en «y N más». */
export const NEWS_MAX_OFFERS = 5;

const DAY_MS = 86_400_000;

/** Desde cuándo cuentan las ofertas nuevas: desde el último envío, sin pasarse de 7 días atrás. */
export function newsWindowStart(lastSentAt: Date | null, now: Date): Date {
  const floor = new Date(now.getTime() - NEWS_WINDOW_DAYS * DAY_MS);
  if (!lastSentAt || !Number.isFinite(lastSentAt.getTime())) return floor;
  return lastSentAt.getTime() > floor.getTime() ? lastSentAt : floor;
}

export type NewsDecision =
  { send: true } | { send: false; reason: "apagado" | "baja" | "reciente" | "sin_novedades" };

export function decideNewsEmail(input: {
  /** `newsEmailAllowed` para esta persona. */
  allowed: boolean;
  /** `profiles.news_email`. */
  optedIn: boolean;
  lastSentAt: Date | null;
  now: Date;
  /** Ofertas nuevas de su carrera desde `newsWindowStart`. */
  newOffers: number;
}): NewsDecision {
  if (!input.allowed) return { send: false, reason: "apagado" };
  if (!input.optedIn) return { send: false, reason: "baja" };
  if (input.lastSentAt) {
    const elapsed = input.now.getTime() - input.lastSentAt.getTime();
    // Un envío «en el futuro» (reloj raro) también cuenta como reciente: falla cerrado
    if (!Number.isFinite(elapsed) || elapsed < NEWS_MIN_DAYS_BETWEEN * DAY_MS) {
      return { send: false, reason: "reciente" };
    }
  }
  if (!Number.isFinite(input.newOffers) || input.newOffers < 1) {
    return { send: false, reason: "sin_novedades" };
  }
  return { send: true };
}

export type NewsOffer = {
  /** `jobs.id` de la persona; solo arma el enlace si tiene la forma de un id. */
  id: string;
  title: string;
  company: string | null;
  /** Puntaje de la última evaluación; null = sin evaluar. */
  score: number | null;
};

export type NewsSealWords = { alta: string; media: string; baja: string; sin_evaluar: string };

export type NewsEmailInput = {
  displayName: string;
  /** Rótulos de las carreras de la persona (del catálogo, nunca de un pedido). */
  careerLabels: readonly string[];
  /** Las ofertas nuevas, de la más afín a la menos; se muestran las primeras `NEWS_MAX_OFFERS`. */
  offers: readonly NewsOffer[];
  /** Cuántas ofertas nuevas hay en total (puede ser más que `offers`). */
  total: number;
  /** Origen público de la app, sin barra final. */
  appUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
  contactEmail: string | null;
  sealWords: NewsSealWords;
  /** La aclaración fija de la evaluación (regla 5 del plan R30 a R34). */
  aclaracion: string;
};

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

function firstName(displayName: string): string {
  return (displayName.trim().split(/\s+/)[0] ?? "").slice(0, 40);
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

function sealText(score: number | null, words: NewsSealWords): string {
  if (score === null || !Number.isFinite(score)) return words.sin_evaluar;
  return `${words[sealLevel(score)]}, ${formatAffinityScore(score)} de 10`;
}

export function buildNewsEmail(input: NewsEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const app = input.appUrl.replace(/\/+$/, "");
  const name = firstName(input.displayName);
  const shown = input.offers.slice(0, NEWS_MAX_OFFERS);
  const more = Math.max(0, input.total - shown.length);
  const careers = joinLabels(input.careerLabels);

  const lines: string[] = [];
  lines.push(name ? `Hola ${name}:` : "Hola:");
  lines.push("");
  lines.push(
    careers
      ? `Hay ofertas nuevas de ${careers} desde tu último resumen. Estas son las primeras:`
      : "Hay ofertas nuevas desde tu último resumen. Estas son las primeras:",
  );
  lines.push("");
  shown.forEach((offer, i) => {
    const link = SAFE_ID.test(offer.id) ? `${app}/jobs/${offer.id}` : `${app}/jobs`;
    lines.push(`${i + 1}. ${offer.title}${offer.company ? ` · ${offer.company}` : ""}`);
    lines.push(`   ${sealText(offer.score, input.sealWords)}`);
    lines.push(`   ${link}`);
    lines.push("");
  });
  if (more > 0) {
    lines.push(`y ${more} más en la app:`);
    lines.push(`${app}/jobs`);
    lines.push("");
  }
  lines.push(input.aclaracion);
  lines.push("La decisión es siempre tuya: nunca postulamos por vos.");
  lines.push("");
  lines.push(
    "Te escribimos como mucho una vez por semana, y solo si hay ofertas nuevas de tu carrera.",
  );
  lines.push(`Dejar de recibir este email: ${input.unsubscribeUrl}`);
  lines.push(`También lo cambiás en Ajustes: ${input.settingsUrl}`);
  if (input.contactEmail) {
    lines.push("");
    lines.push(`¿Dudas? Escribinos a ${input.contactEmail}.`);
  }
  const text = lines.join("\n");
  return {
    // Neutro: sin números, carreras ni títulos
    subject: `Ofertas nuevas en ${PRODUCT_NAME}`,
    text,
    // Lo que viene de un aviso se escapa en `textToEmailHtml`; los enlaces del texto los vuelve links ese helper
    html: brandedEmailHtml({
      bodyHtml: textToEmailHtml(text),
      preheader: "Las ofertas nuevas de tu carrera",
      mascotAppUrl: app,
    }),
  };
}
