import type { CvCandidate } from "./candidates";

export type CvPromptVars = {
  target_roles: string;
  candidate_skills: string;
  today: string;
  cv: string;
};

/** `<<<` y `>>>` del CV no pueden cerrar ni abrir el bloque que arma el código. */
const neutralize = (text: string): string => text.replace(/<{3,}/g, "‹‹‹").replace(/>{3,}/g, "›››");

export function buildCvPromptVars(input: {
  text: string;
  roleLabels: readonly string[];
  candidates: readonly CvCandidate[];
  today: string;
}): CvPromptVars {
  return {
    target_roles: input.roleLabels.join(", "),
    candidate_skills: input.candidates.map((c) => `${c.slug} | ${c.name}`).join("\n"),
    today: input.today,
    cv: `<<<CV>>>\n${neutralize(input.text)}\n<<<FIN CV>>>`,
  };
}
