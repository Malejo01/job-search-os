import { saveAcceptedCards, type CardSaveResult } from "@job-search-os/adapters";
import {
  CARD_REJECTION_MESSAGES,
  reviewCardDecisions,
  type CardRejection,
  type ProfileCardDecision,
} from "@job-search-os/pipeline";
import { withUser } from "@/lib/db";
import { getSkillTaxonomy } from "@/lib/skill-taxonomy";

/**
 * Guardado de las tarjetas aceptadas (ADR-034 §2, R10-2). Lo que vuelve del navegador es entrada no
 * confiable: se vuelve a validar y a filtrar (`reviewCardDecisions`) antes de tocar la base, y el guardado
 * corre con `withUser` (rol `jobsearch_app`, RLS), la única forma en que la app escribe datos de una
 * persona. La respuesta lleva estados y mensajes fijos, nunca el texto de una tarjeta.
 */
export type CardsOutcome = {
  saved: CardSaveResult[];
  rejected: { id: string; reason: CardRejection; message: string }[];
  discarded: string[];
};

export async function saveProfileCards(
  userId: string,
  decisions: readonly ProfileCardDecision[],
): Promise<CardsOutcome> {
  const taxonomy = (await getSkillTaxonomy()).map(({ slug, name, aliases }) => ({
    slug,
    name,
    aliases,
  }));
  const review = reviewCardDecisions(decisions, taxonomy);
  const saved =
    review.accepted.length > 0
      ? await withUser(userId, (tx) => saveAcceptedCards(tx, userId, review.accepted))
      : [];
  return {
    saved,
    rejected: review.rejected.map((r) => ({
      ...r,
      message: CARD_REJECTION_MESSAGES[r.reason],
    })),
    discarded: review.discarded,
  };
}
