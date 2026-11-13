/**
 * De una respuesta de la persona a una tarjeta para confirmar (ADR-034 §1 y §2). Puro. El modelo
 * (`cv_interview`) solo extrae lo que la persona dijo; acá el código decide si eso es una tarjeta, si se
 * repregunta y cómo se aplica al historial. Una tarjeta con datos sensibles o con una instrucción escondida
 * se descarta entera (`screenProfileCard`), no se limpia.
 */
import { cvDeclined } from "../../cv-chat/follow-up";
import {
  validateHistory,
  type HistoryField,
  type HistoryInput,
  HISTORY_MAX_BULLETS,
} from "../../cv-out/history";
import { foldCvText } from "../../cv-out/verify";
import { err, ok, type Result } from "../../result";
import { PROFILE_AGENT_MAX_FOLLOW_UPS } from "../limits";
import { profileGapCardSchema, type ProfileGapAnswer, type ProfileGapCard } from "../schemas";
import { screenProfileCard } from "../screen";
import {
  gapKeyForHistory,
  gapKeyForSkill,
  hasConcreteDuty,
  type GapHistoryRow,
  type GapTopicRef,
} from "./detect";

/** Lo que `cv_interview` extrajo de la respuesta, por tema. */
export type GapExtraction =
  | { topic: "dates"; startMonth: string | null; endMonth: string | null; isCurrent: boolean }
  | { topic: "duties"; duties: readonly string[] }
  | { topic: "achievement"; achievement: string | null };

export type GapCardResult =
  | { ok: true; card: ProfileGapCard }
  | { ok: false; reason: "empty" | "unchanged" | "invalid" | "sensitive" | "injection" };

/**
 * «No tengo»: el botón, o escrito con palabras («no tengo», «no me acuerdo», «prefiero no»). Cierra el tema
 * sin repreguntar y sin llamar al modelo.
 */
export function isGapDeclined(answer: ProfileGapAnswer): boolean {
  return answer.kind === "none" || (answer.kind === "text" && cvDeclined(answer.text));
}

function screened(raw: unknown): GapCardResult {
  const parsed = profileGapCardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const s = screenProfileCard(parsed.data);
  if (!s.ok) return { ok: false, reason: s.reason };
  return { ok: true, card: parsed.data };
}

/** La tarjeta que sale de lo extraído, o el motivo por el que no hay tarjeta. `row` es la fila actual. */
export function buildGapCard(
  ref: GapTopicRef,
  extraction: GapExtraction | null,
  row: Pick<GapHistoryRow, "startMonth" | "endMonth"> | null,
): GapCardResult {
  if (extraction === null || ref.historyId === null || extraction.topic !== ref.topic) {
    return { ok: false, reason: "empty" };
  }
  switch (extraction.topic) {
    case "dates": {
      if (extraction.startMonth === null && extraction.endMonth === null && !extraction.isCurrent) {
        return { ok: false, reason: "empty" };
      }
      const endMonth = extraction.isCurrent ? null : extraction.endMonth;
      if (row !== null && row.startMonth === extraction.startMonth && row.endMonth === endMonth) {
        return { ok: false, reason: "unchanged" };
      }
      return screened({
        field: "dates",
        key: ref.key,
        historyId: ref.historyId,
        startMonth: extraction.startMonth,
        endMonth,
        isCurrent: extraction.isCurrent,
      });
    }
    case "duties":
      return extraction.duties.length === 0
        ? { ok: false, reason: "empty" }
        : screened({
            field: "duties",
            key: ref.key,
            historyId: ref.historyId,
            bullets: [...extraction.duties],
          });
    case "achievement":
      return extraction.achievement === null
        ? { ok: false, reason: "empty" }
        : screened({
            field: "achievement",
            key: ref.key,
            historyId: ref.historyId,
            bullet: extraction.achievement,
          });
  }
}

/** Nivel elegido con los botones (1 a 3) → tarjeta de skill. Sin `slug` no hay tarjeta. */
export function buildSkillLevelCard(ref: GapTopicRef, level: 1 | 2 | 3): GapCardResult {
  if (ref.topic !== "skill_level" || ref.skillSlug === null || ref.skillName === null) {
    return { ok: false, reason: "empty" };
  }
  return screened({
    field: "skill_level",
    key: ref.key,
    name: ref.skillName,
    slug: ref.skillSlug,
    level,
  });
}

/**
 * ¿Hay que repreguntar? Solo en temas de trabajo, hasta `PROFILE_AGENT_MAX_FOLLOW_UPS` veces por tema, y
 * nunca si la persona dijo «no tengo» o si lo que escribió se descartó por sensible o por instrucción
 * (no se insiste). Una respuesta que no se pudo leer (`extraction` null) también se repregunta.
 */
export function shouldFollowUp(input: {
  topic: GapTopicRef["topic"];
  extraction: GapExtraction | null;
  card: GapCardResult;
  asked: number;
}): boolean {
  if (input.topic === "skill_level") return false;
  if (!(input.asked < PROFILE_AGENT_MAX_FOLLOW_UPS)) return false;
  if (!input.card.ok && (input.card.reason === "sensitive" || input.card.reason === "injection")) {
    return false;
  }
  const ex = input.extraction;
  if (ex === null || ex.topic !== input.topic) return true;
  switch (ex.topic) {
    case "dates":
      return ex.startMonth === null || (ex.endMonth === null && !ex.isCurrent);
    case "duties":
      return !hasConcreteDuty(ex.duties);
    case "achievement":
      return ex.achievement === null;
  }
}

/**
 * La tarjeta apunta a lo que dice su `key`: una tarjeta que vuelve del navegador con la clave de otra fila
 * o de otro tema no se acepta.
 */
export function gapCardKeyMatches(card: ProfileGapCard): boolean {
  if (card.field === "skill_level") {
    return card.slug !== null && card.key === gapKeyForSkill(card.slug);
  }
  return card.key === gapKeyForHistory(card.historyId, card.field);
}

const dedupe = (items: readonly string[]): string[] => {
  const seen = new Set<string>();
  return items.filter((b) => {
    const k = foldCvText(b);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Aplica una tarjeta confirmada a la fila de `career_history` y la valida con la misma función que la carga
 * manual. Las viñetas se suman al final (sin duplicar) y no pasan del máximo: si no entran, devuelve `bullets`
 * y no se pierde nada de lo que ya estaba. Las tarjetas de skill no pasan por acá.
 */
export function applyGapCardToHistory(
  row: HistoryInput,
  card: Exclude<ProfileGapCard, { field: "skill_level" }>,
): Result<HistoryInput, HistoryField> {
  let { startMonth, endMonth } = row;
  let bullets: string[] = [...row.bullets];
  switch (card.field) {
    case "dates":
      startMonth = card.startMonth;
      endMonth = card.isCurrent ? null : card.endMonth;
      break;
    case "duties":
      bullets = dedupe([...bullets, ...card.bullets]);
      break;
    case "achievement":
      bullets = dedupe([...bullets, card.bullet]);
      break;
  }
  if (bullets.length > HISTORY_MAX_BULLETS) return err("bullets");
  const checked = validateHistory({
    get: (name: string): unknown => {
      switch (name) {
        case "kind":
          return row.kind;
        case "organization":
          return row.organization;
        case "title":
          return row.title;
        case "startMonth":
          return startMonth ?? "";
        case "endMonth":
          return endMonth ?? "";
        case "bullets":
          return bullets.join("\n");
        default:
          return "";
      }
    },
  });
  return checked.ok ? ok(checked.value) : err(checked.field);
}
