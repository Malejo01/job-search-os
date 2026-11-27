/**
 * Revisar mi CV para esta oferta (R34-02, R-36). Puro: junta lo que pide el aviso (skills y filas de la
 * tabla de requisitos) con el CV confirmado y dice tres cosas: qué ya se ve en el CV, qué no tiene respaldo
 * y qué conviene aclarar. No reescribe nada, no llama a un modelo y no suma ninguna habilidad ni dato que la
 * persona no declaró (R-38): lo que falta se nombra, no se completa. «Sin respaldo» no es «te falta»: puede
 * ser algo que la persona hizo y todavía no cargó.
 */
import {
  cvForOffer,
  type CvForOfferError,
  type CvForOfferInput,
  type RankedBullet,
} from "./cv-for-offer";
import { err, ok, type Result } from "./result";
import type { RequirementCode, RequirementState } from "./requirements/summary";

/** Una fila de la tabla de requisitos, ya resuelta (`summarizeRequirements`). */
export interface OfferRequirementInput {
  code: RequirementCode;
  nivel: "must" | "deseable";
  state: RequirementState;
  pide: string;
}

export interface CvOfferReviewInput extends CvForOfferInput {
  requirements: readonly OfferRequirementInput[];
}

export interface CvOfferEvidence {
  /** La viñeta original, sin tocar. */
  text: string;
  organization: string;
  title: string;
}

export type CvOfferClarify =
  | { kind: "skill_sin_experiencia"; name: string; isMust: boolean }
  | { kind: "requisito"; code: RequirementCode; nivel: "must" | "deseable"; pide: string };

export interface CvOfferReview {
  /** Lo que el aviso pide y el CV ya muestra (en una viñeta o en la lista de skills). */
  covered: { name: string; isMust: boolean; evidence: CvOfferEvidence | null }[];
  /** Lo que el aviso pide y el CV no menciona. */
  unbacked: { name: string; isMust: boolean }[];
  /** Lo que conviene aclarar: skills que solo figuran en la lista, y requisitos que el CV puede mostrar. */
  toClarify: CvOfferClarify[];
  /** Viñetas que mencionan algo de la oferta primero (igual que `cvForOffer`), sin reescribir. */
  bullets: RankedBullet[];
}

/** Filas de la tabla que el CV puede ayudar a aclarar. País, residencia, modalidad o sueldo no son del CV. */
const CV_CLARIFIABLE: ReadonlySet<RequirementCode> = new Set([
  "ingles",
  "anos",
  "disciplina",
  "req",
  "otro",
]);

export function reviewCvForOffer(
  input: CvOfferReviewInput,
): Result<CvOfferReview, CvForOfferError> {
  const base = cvForOffer(input);
  if (!base.ok) return err(base.error);
  const { asked, bullets } = base.value;

  const evidenceOf = new Map<string, CvOfferEvidence>();
  for (const b of bullets) {
    for (const name of b.matched) {
      if (!evidenceOf.has(name)) {
        evidenceOf.set(name, { text: b.text, organization: b.organization, title: b.title });
      }
    }
  }

  const covered = asked
    .filter((a) => a.inCv)
    .map((a) => ({ name: a.name, isMust: a.isMust, evidence: evidenceOf.get(a.name) ?? null }));
  const unbacked = asked.filter((a) => !a.inCv).map((a) => ({ name: a.name, isMust: a.isMust }));

  const toClarify: CvOfferClarify[] = [
    ...covered
      .filter((c) => c.evidence === null)
      .map((c) => ({ kind: "skill_sin_experiencia" as const, name: c.name, isMust: c.isMust })),
    ...input.requirements
      .filter((r) => r.state === "sinConfirmar" && CV_CLARIFIABLE.has(r.code))
      .map((r) => ({ kind: "requisito" as const, code: r.code, nivel: r.nivel, pide: r.pide })),
  ];

  return ok({ covered, unbacked, toClarify, bullets });
}
