import type { CvDocument } from "../cv-out/model";
import { CV_TAILOR_MAX_CHANGES, type CvTailorOutput } from "./schemas";
import { cvTailorRefs, parseSkillBlock } from "./verify";

/**
 * Sugerencias de «Adaptar a esta oferta» para aceptar, editar o descartar de a una (R34-02). Puro.
 * El modelo propone y `verifyCvTailor` ya lo verificó; acá solo se compara el CV de hoy con la versión
 * verificada para mostrar una tarjeta por cambio, y se arma de nuevo una propuesta con lo que la persona
 * decidió. La propuesta recompuesta vuelve a pasar por `verifyCvTailor`: una edición que sume algo que la
 * persona no declaró se rechaza ahí, nunca se aplica. Lo que no tiene decisión no entra.
 */

export interface TailorSuggestion {
  /** Referencia de la entrada (`experience-0`) o `skills`. */
  id: string;
  kind: "entry" | "skills";
  heading: string;
  before: string[];
  after: string[];
  /** Solo las viñetas se editan; el orden de skills se acepta o se descarta. */
  editable: boolean;
}

export type TailorDecision =
  { id: string; action: "accept" | "discard" } | { id: string; action: "edit"; bullets: string[] };

export function buildTailorSuggestions(
  original: CvDocument,
  tailored: CvDocument,
): TailorSuggestion[] {
  const out: TailorSuggestion[] = [];
  for (const [ref, at] of cvTailorRefs(original)) {
    const a = original.sections.find((s) => s.id === at.sectionId)?.blocks[at.blockIndex];
    const b = tailored.sections.find((s) => s.id === at.sectionId)?.blocks[at.blockIndex];
    if (!a || !b || JSON.stringify(a.bullets) === JSON.stringify(b.bullets)) continue;
    out.push({
      id: ref,
      kind: "entry",
      heading: [a.heading, a.detail].filter((x): x is string => !!x).join(" · "),
      before: [...a.bullets],
      after: [...b.bullets],
      editable: true,
    });
  }
  const skillLines = (d: CvDocument): string[] =>
    (d.sections.find((s) => s.id === "skills")?.blocks ?? []).flatMap((blk) => {
      const { label, items } = parseSkillBlock(blk.detail);
      return items.length ? [`${label ? `${label}: ` : ""}${items.join(", ")}`] : [];
    });
  const sb = skillLines(original);
  const sa = skillLines(tailored);
  if (JSON.stringify(sb) !== JSON.stringify(sa)) {
    out.push({ id: "skills", kind: "skills", heading: "", before: sb, after: sa, editable: false });
  }
  return out;
}

/** Propuesta con solo lo decidido. Sin decisión o con un id que no existe, no entra nada. */
export function composeTailorProposal(
  proposal: CvTailorOutput,
  decisions: readonly TailorDecision[],
): CvTailorOutput {
  const byId = new Map<string, TailorDecision>();
  for (const d of decisions) if (!byId.has(d.id)) byId.set(d.id, d);

  const entries: CvTailorOutput["entries"] = [];
  for (const e of proposal.entries) {
    const d = byId.get(e.ref);
    if (!d || d.action === "discard") continue;
    entries.push({ ref: e.ref, bullets: d.action === "edit" ? [...d.bullets] : [...e.bullets] });
  }
  const skillsDecision = byId.get("skills");
  const skills = skillsDecision?.action === "accept" ? [...proposal.skills] : [];
  const anything = entries.length > 0 || skills.length > 0;
  return {
    entries,
    skills,
    changes: anything ? proposal.changes.slice(0, CV_TAILOR_MAX_CHANGES) : [],
  };
}
