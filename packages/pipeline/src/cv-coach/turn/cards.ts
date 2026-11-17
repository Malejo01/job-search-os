/**
 * De la salida de `cv_coach_turn` a tarjetas para confirmar (ADR-038 §3 y §5). Puro. El modelo extrae; el
 * código decide qué es una tarjeta, a qué ítem va y si choca con lo que ya dice el CV. Nada entra al CV sin
 * el clic de la persona (patrón `ProfileGapCard`): esto solo propone.
 *
 * Cada tarjeta pasa, entera, por:
 * - grounding (`extractionGrounded`) contra el mensaje de la persona: números, nombres propios y
 *   tecnologías tienen que estar en lo que escribió; el año de cada mes también; el link, tal cual;
 * - datos sensibles (`hasSensitiveCvData` y `findProfileSensitive`) e instrucciones escondidas
 *   (`detectCvInjection`);
 * - el esquema estricto de la tarjeta.
 * Lo que no pasa se descarta entero (falla cerrado): nunca se recorta una tarjeta para que pase.
 *
 * Lo dicho fuera de foco (`extras`) no se pierde: si apunta a un ítem del CV, es una tarjeta de ese ítem;
 * si es un trabajo, proyecto o estudio nuevo, una tarjeta de ítem nuevo; si no se puede ubicar, una nota
 * para revisar.
 */
import { z } from "zod";
import { detectCvInjection } from "../../cv/injection";
import { hasSensitiveCvData } from "../../cv-chat/follow-up";
import { extractionGrounded } from "../../cv-chat/grounding";
import { CV_BULLET_MAX_CHARS, foldCvText, hasLinkOrEmail } from "../../cv-out/verify";
import { projectLinkSchema } from "../../profile-agent/schemas";
import { findProfileSensitive } from "../../profile-agent/sensitive";
import {
  CV_COACH_EXTRA_KINDS,
  type CvCoachExtra,
  type CvCoachPatch,
  type CvCoachTurnOutput,
  type CvItemRef,
} from "../schemas";
import type { CvCoachItem, CvCoachTurnContext } from "./context";
import { formatCoachRange, parseCoachRange } from "./months";

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// Saltos de línea, control e invisibles (sin escribirlos en el fuente)
const CONTROL_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]",
);
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((t) => !CONTROL_RE.test(t), { message: "caracteres_de_control" })
    .refine((t) => !hasLinkOrEmail(t), { message: "link_o_email" });
const uuid = z.string().uuid();

export const cvCoachCardKeySchema = z.string().regex(/^cc:\d{1,2}$/);

export const CV_COACH_CARD_SOURCES = ["patch", ...CV_COACH_EXTRA_KINDS] as const;

type Dates = { startMonth: string | null; endMonth: string | null; isCurrent: boolean };
const datesOk = (v: Dates): boolean =>
  (v.endMonth === null || v.startMonth !== null) &&
  (v.startMonth === null || v.endMonth === null || v.endMonth >= v.startMonth) &&
  (!v.isCurrent || v.endMonth === null);

/**
 * Tarjeta del coach. `historyId` es la fila de `career_history` a la que se aplica (`null` en una nota o un
 * stack que no se pudo ubicar: la pantalla le pide a la persona que elija dónde va).
 * - `bullets`: viñetas nuevas para el ítem.
 * - `dates`: fechas del ítem ya combinadas con lo que tenía (lo que la persona no dijo queda como estaba).
 * - `names`: cargo o empresa / nombre del proyecto; `null` = sin cambio.
 * - `link`: link del proyecto (solo proyectos, ADR-038 §6).
 * - `stack`: herramientas del ítem (el cierre las guarda como viñeta «Stack: …»).
 * - `new_item`: un trabajo, proyecto o estudio que no está en el CV; la persona completa el resto.
 * - `note`: algo que dijo y no se pudo ubicar; no entra al CV hasta que la persona lo ubique.
 */
export const cvCoachCardSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("bullets"),
    key: cvCoachCardKeySchema,
    historyId: uuid,
    bullets: z.array(line(CV_BULLET_MAX_CHARS)).min(1).max(4),
    source: z.enum(CV_COACH_CARD_SOURCES),
  }),
  z
    .strictObject({
      kind: z.literal("dates"),
      key: cvCoachCardKeySchema,
      historyId: uuid,
      startMonth: MONTH.nullable(),
      endMonth: MONTH.nullable(),
      isCurrent: z.boolean(),
    })
    .refine(datesOk, { message: "fechas" }),
  z
    .strictObject({
      kind: z.literal("names"),
      key: cvCoachCardKeySchema,
      historyId: uuid,
      title: line(120).nullable(),
      organization: line(120).nullable(),
    })
    .refine((c) => c.title !== null || c.organization !== null, { message: "vacia" }),
  z.strictObject({
    kind: z.literal("link"),
    key: cvCoachCardKeySchema,
    historyId: uuid,
    link: projectLinkSchema,
  }),
  z.strictObject({
    kind: z.literal("stack"),
    key: cvCoachCardKeySchema,
    historyId: uuid.nullable(),
    stack: z.array(line(60)).min(1).max(12),
  }),
  z.strictObject({
    kind: z.literal("new_item"),
    key: cvCoachCardKeySchema,
    itemKind: z.enum(["trabajo", "proyecto", "educacion"]),
    text: line(CV_BULLET_MAX_CHARS),
  }),
  z.strictObject({
    kind: z.literal("note"),
    key: cvCoachCardKeySchema,
    historyId: uuid.nullable(),
    text: line(CV_BULLET_MAX_CHARS),
    about: z.enum(CV_COACH_CARD_SOURCES),
  }),
]);
export type CvCoachCard = z.infer<typeof cvCoachCardSchema>;
type CardDraft = CvCoachCard extends infer C ? (C extends unknown ? Omit<C, "key"> : never) : never;

export type CoachDropReason = "sin_respaldo" | "sensible" | "instruccion" | "invalida" | "sin_item";

/** Contradicción con lo confirmado: se pregunta con plantilla y dos botones, sin modelo (ADR-038 §5). */
export type CoachConflict = {
  cardKey: string;
  field: "dates" | "names";
  /** Lo que figura en el CV. */
  before: string;
  /** Lo que dijo la persona. */
  after: string;
};

export type CoachCardsResult = {
  cards: CvCoachCard[];
  dropped: CoachDropReason[];
  /** Datos que la persona repitió tal cual estaban: no son tarjeta, pero tampoco una respuesta ilegible. */
  unchanged: number;
  conflicts: CoachConflict[];
};

type Candidate = { draft: CardDraft; ground: unknown; link?: string };

/** Textos libres de una tarjeta, para revisar datos sensibles e instrucciones. */
export function coachCardTexts(card: CardDraft | CvCoachCard): string[] {
  switch (card.kind) {
    case "bullets":
      return card.bullets;
    case "names":
      return [card.title, card.organization].filter((x): x is string => x !== null);
    case "stack":
      return card.stack;
    case "new_item":
    case "note":
      return [card.text];
    case "dates":
    case "link":
      return [];
  }
}

/** Revisión de una tarjeta (también la que vuelve del navegador, que es entrada no confiable). */
export function screenCoachCard(card: CardDraft | CvCoachCard): CoachDropReason | null {
  const texts = coachCardTexts(card);
  if (
    hasSensitiveCvData(texts.join("\n")) ||
    texts.some((t) => findProfileSensitive(t).length > 0)
  ) {
    return "sensible";
  }
  if (texts.some((t) => detectCvInjection(t).hit)) return "instruccion";
  return null;
}

const same = (a: string | null, b: string | null): boolean =>
  foldCvText(a ?? "")
    .replace(/\s+/g, " ")
    .trim() ===
  foldCvText(b ?? "")
    .replace(/\s+/g, " ")
    .trim();

function itemFor(ref: CvItemRef | null, ctx: CvCoachTurnContext): CvCoachItem | null {
  if (!ref || ref.itemId === null) return null;
  const item = ctx.items.find((i) => i.id === ref.itemId);
  return item && item.section === ref.section ? item : null;
}

/** Fechas del ítem combinadas con lo dicho; `null` si no dijo nada de fechas. */
function mergedDates(
  item: CvCoachItem,
  said: { startMonth: string | null; endMonth: string | null; isCurrent: boolean | null },
): Dates | null {
  if (said.startMonth === null && said.endMonth === null && said.isCurrent === null) return null;
  const isCurrent = said.isCurrent ?? (said.endMonth !== null ? false : item.isCurrent);
  return {
    startMonth: said.startMonth ?? item.startMonth,
    endMonth: isCurrent ? null : (said.endMonth ?? item.endMonth),
    isCurrent,
  };
}

function datesConflict(item: CvCoachItem, d: Dates): boolean {
  if (item.startMonth !== null && d.startMonth !== item.startMonth) return true;
  if (item.endMonth !== null && d.endMonth !== item.endMonth) return true;
  return item.isCurrent && !d.isCurrent && d.endMonth !== null;
}

function patchCandidates(
  patch: CvCoachPatch,
  focus: CvCoachItem | null,
  dropped: CoachDropReason[],
): Candidate[] {
  const out: Candidate[] = [];
  if (focus === null) {
    // Problema de una sección entera: lo que no tiene ítem queda como nota (no se pierde)
    for (const b of patch.bullets) {
      out.push({
        draft: { kind: "note", historyId: null, text: b, about: "patch" },
        ground: { b },
      });
    }
    if (patch.stack.length > 0) {
      out.push({
        draft: { kind: "stack", historyId: null, stack: patch.stack },
        ground: { s: patch.stack },
      });
    }
    const placeless =
      patch.title !== null ||
      patch.organization !== null ||
      patch.startMonth !== null ||
      patch.endMonth !== null ||
      patch.isCurrent !== null ||
      patch.link !== null;
    if (placeless) dropped.push("sin_item");
    return out;
  }
  if (patch.title !== null || patch.organization !== null) {
    out.push({
      draft: {
        kind: "names",
        historyId: focus.id,
        title: patch.title,
        organization: patch.organization,
      },
      ground: { title: patch.title, organization: patch.organization },
    });
  }
  const said = {
    startMonth: patch.startMonth,
    endMonth: patch.endMonth,
    isCurrent: patch.isCurrent,
  };
  const dates = mergedDates(focus, said);
  if (dates) {
    out.push({
      draft: { kind: "dates", historyId: focus.id, ...dates },
      ground: { startMonth: patch.startMonth, endMonth: patch.endMonth },
    });
  }
  if (patch.bullets.length > 0) {
    out.push({
      draft: { kind: "bullets", historyId: focus.id, bullets: patch.bullets, source: "patch" },
      ground: { bullets: patch.bullets },
    });
  }
  if (patch.link !== null) {
    if (focus.section !== "projects") dropped.push("sin_item");
    else {
      out.push({
        draft: { kind: "link", historyId: focus.id, link: patch.link },
        ground: {},
        link: patch.link,
      });
    }
  }
  if (patch.stack.length > 0) {
    out.push({
      draft: { kind: "stack", historyId: focus.id, stack: patch.stack },
      ground: { stack: patch.stack },
    });
  }
  return out;
}

const NEW_ITEM_KIND = { trabajo: "trabajo", proyecto: "proyecto", estudio: "educacion" } as const;

function extraCandidate(extra: CvCoachExtra, ctx: CvCoachTurnContext): Candidate {
  const item = itemFor(extra.ref, ctx);
  const ground = { text: extra.text };
  if (extra.kind === "fecha") {
    const range = item ? parseCoachRange(extra.text) : null;
    const dates = item && range ? mergedDates(item, range) : null;
    if (item && range && dates) {
      return {
        draft: { kind: "dates", historyId: item.id, ...dates },
        ground: { text: extra.text, startMonth: range.startMonth, endMonth: range.endMonth },
      };
    }
    return {
      draft: { kind: "note", historyId: item?.id ?? null, text: extra.text, about: "fecha" },
      ground,
    };
  }
  if (item) {
    return {
      draft: { kind: "bullets", historyId: item.id, bullets: [extra.text], source: extra.kind },
      ground,
    };
  }
  if (extra.kind === "trabajo" || extra.kind === "proyecto" || extra.kind === "estudio") {
    return {
      draft: { kind: "new_item", itemKind: NEW_ITEM_KIND[extra.kind], text: extra.text },
      ground,
    };
  }
  return { draft: { kind: "note", historyId: null, text: extra.text, about: extra.kind }, ground };
}

/** Saca lo que el ítem ya tenía; `null` si no queda nada nuevo. */
function withoutUnchanged(draft: CardDraft, ctx: CvCoachTurnContext): CardDraft | null {
  const item =
    "historyId" in draft && draft.historyId
      ? ctx.items.find((i) => i.id === draft.historyId)
      : null;
  if (!item) return draft;
  switch (draft.kind) {
    case "bullets": {
      const have = new Set(item.bullets.map((b) => foldCvText(b).replace(/\s+/g, " ").trim()));
      const seen = new Set<string>();
      const bullets = draft.bullets.filter((b) => {
        const k = foldCvText(b).replace(/\s+/g, " ").trim();
        if (have.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return bullets.length > 0 ? { ...draft, bullets } : null;
    }
    case "dates":
      return draft.startMonth === item.startMonth &&
        draft.endMonth === item.endMonth &&
        draft.isCurrent === item.isCurrent
        ? null
        : draft;
    case "names": {
      const title = draft.title !== null && !same(draft.title, item.title) ? draft.title : null;
      const organization =
        draft.organization !== null && !same(draft.organization, item.organization)
          ? draft.organization
          : null;
      return title === null && organization === null ? null : { ...draft, title, organization };
    }
    case "link":
      return item.link !== null && same(item.link, draft.link) ? null : draft;
    default:
      return draft;
  }
}

/**
 * Tarjetas de un turno. `focus` es el ítem del problema en foco (`null` si el problema es de una sección
 * entera). `message` es lo que escribió la persona: la única fuente válida de lo extraído.
 */
export function buildCoachCards(
  output: CvCoachTurnOutput,
  focus: CvCoachItem | null,
  ctx: CvCoachTurnContext,
  message: string,
): CoachCardsResult {
  const dropped: CoachDropReason[] = [];
  const candidates = [
    ...patchCandidates(output.patch, focus, dropped),
    ...output.extras.map((e) => extraCandidate(e, ctx)),
  ];
  const foldedMessage = foldCvText(message);
  const cards: CvCoachCard[] = [];
  const conflicts: CoachConflict[] = [];
  let unchanged = 0;
  for (const c of candidates) {
    if (!extractionGrounded(c.ground, message)) {
      dropped.push("sin_respaldo");
      continue;
    }
    if (c.link !== undefined && !foldedMessage.includes(foldCvText(c.link))) {
      dropped.push("sin_respaldo");
      continue;
    }
    const screened = screenCoachCard(c.draft);
    if (screened) {
      dropped.push(screened);
      continue;
    }
    const draft = withoutUnchanged(c.draft, ctx);
    if (draft === null) {
      unchanged++;
      continue;
    }
    const key = `cc:${cards.length}`;
    const parsed = cvCoachCardSchema.safeParse({ ...draft, key });
    if (!parsed.success) {
      dropped.push("invalida");
      continue;
    }
    if (cards.length >= 99) break;
    const card = parsed.data;
    cards.push(card);
    const conflict = conflictOf(card, ctx);
    if (conflict) conflicts.push(conflict);
  }
  return { cards, dropped, unchanged, conflicts };
}

function conflictOf(card: CvCoachCard, ctx: CvCoachTurnContext): CoachConflict | null {
  if (card.kind !== "dates" && card.kind !== "names") return null;
  const item = ctx.items.find((i) => i.id === card.historyId);
  if (!item) return null;
  if (card.kind === "dates") {
    if (!datesConflict(item, card)) return null;
    const before = formatCoachRange(item);
    const after = formatCoachRange(card);
    return before && after ? { cardKey: card.key, field: "dates", before, after } : null;
  }
  const parts: [string, string][] = [];
  if (card.organization !== null && item.organization.trim() !== "") {
    parts.push([item.organization, card.organization]);
  }
  if (card.title !== null && item.title.trim() !== "") parts.push([item.title, card.title]);
  if (parts.length === 0) return null;
  return {
    cardKey: card.key,
    field: "names",
    before: parts.map((p) => p[0]).join(", "),
    after: parts.map((p) => p[1]).join(", "),
  };
}
