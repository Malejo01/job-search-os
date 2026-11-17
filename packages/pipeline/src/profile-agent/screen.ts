/**
 * Revisión de las tarjetas antes de mostrarlas y antes de guardarlas (ADR-034). Puro. El modelo propone y
 * el código decide: una tarjeta con un dato sensible o con una instrucción escondida se DESCARTA entera (no
 * se «limpia»: editarla en silencio dejaría una tarjeta que la persona no escribió). Se corre dos veces:
 * sobre lo que sale del modelo y otra vez sobre lo que vuelve del navegador, que es entrada no confiable.
 */
import { detectCvInjection } from "../cv/injection";
import type { HistoryInput } from "../cv-out/history";
import { findProfileSensitive, type ProfileSensitiveKind } from "./sensitive";
import type {
  EducationCard,
  ExperienceCard,
  ProfileGapCard,
  ProfileGuideCard,
  ProfileReadCard,
} from "./schemas";

export type ProfileCardLike = ProfileReadCard | ProfileGapCard | ProfileGuideCard;

/** Todos los textos libres de una tarjeta, para revisarlos. */
export function profileCardTexts(card: ProfileCardLike): string[] {
  if ("kind" in card) {
    switch (card.kind) {
      case "experience":
        return [card.organization, card.title, ...card.bullets];
      case "education":
        return [card.institution, card.title];
      case "skill":
        return [card.name];
      case "language":
        return [card.name, ...(card.level ? [card.level] : [])];
      case "roles":
        return [];
      case "criteria":
        return card.titleBlocklistAdd;
      case "alert_keywords":
        return card.keywords;
      case "reinforce":
        return [card.name];
    }
  }
  switch (card.field) {
    case "achievement":
      return [card.bullet];
    case "duties":
      return card.bullets;
    case "dates":
      return [];
    case "skill_level":
      return [card.name];
  }
}

export type ProfileScreen =
  | { ok: true }
  | { ok: false; reason: "sensitive"; kinds: ProfileSensitiveKind[] }
  | { ok: false; reason: "injection"; signals: string[] };

/** Devuelve el motivo, nunca el texto. Dato sensible primero: es el que no se puede reportar con contenido. */
export function screenProfileCard(card: ProfileCardLike): ProfileScreen {
  const texts = profileCardTexts(card);
  const kinds = new Set<ProfileSensitiveKind>();
  for (const t of texts) for (const k of findProfileSensitive(t)) kinds.add(k);
  if (kinds.size > 0) return { ok: false, reason: "sensitive", kinds: [...kinds] };
  const signals = new Set<string>();
  for (const t of texts) for (const s of detectCvInjection(t).signals) signals.add(s);
  if (signals.size > 0) return { ok: false, reason: "injection", signals: [...signals] };
  return { ok: true };
}

export type ProfileScreenResult<T> = {
  kept: T[];
  dropped: { index: number; reason: "sensitive" | "injection" }[];
};

/** Separa las tarjetas que pasan de las que no; conserva el orden. */
export function screenProfileCards<T extends ProfileCardLike>(
  cards: readonly T[],
): ProfileScreenResult<T> {
  const kept: T[] = [];
  const dropped: ProfileScreenResult<T>["dropped"] = [];
  cards.forEach((card, index) => {
    const r = screenProfileCard(card);
    if (r.ok) kept.push(card);
    else dropped.push({ index, reason: r.reason });
  });
  return { kept, dropped };
}

/** Texto libre de la persona (una respuesta de la charla): ¿trae algún dato sensible? Devuelve tipos. */
export function screenProfileAnswer(text: string): ProfileSensitiveKind[] {
  return findProfileSensitive(text);
}

/**
 * Experiencia o estudio → la entrada de `career_history` que guardan la carga manual y el chat. El llamador
 * le agrega `source = 'cv'`. Después pasa por la misma validación que la carga manual (`validateHistory`).
 */
export function cardToHistoryInput(card: ExperienceCard | EducationCard): HistoryInput {
  if (card.kind === "experience") {
    return {
      kind: "trabajo",
      organization: card.organization,
      title: card.title,
      startMonth: card.startMonth,
      endMonth: card.isCurrent ? null : card.endMonth,
      bullets: [...card.bullets],
    };
  }
  return {
    kind: "educacion",
    organization: card.institution,
    title: card.title,
    startMonth: card.startMonth,
    endMonth: card.endMonth,
    bullets: [],
  };
}
