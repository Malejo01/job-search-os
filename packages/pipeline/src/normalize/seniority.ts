import { foldText } from "./text";

/**
 * Seniority declarada en el título del aviso (fuentes que no la traen en un campo). Puro y
 * conservador: solo palabras enteras; si no hay señal, `null`.
 */

/** Niveles de menor a mayor, con las frases que los nombran (ya sin acentos ni signos). */
const LEVELS: readonly { value: string; terms: readonly string[] }[] = [
  { value: "Trainee", terms: ["intern", "internship", "trainee", "pasante", "practicante"] },
  { value: "Junior", terms: ["junior", "jr", "entry level"] },
  {
    value: "Semi Senior",
    terms: ["semi senior", "semisenior", "ssr", "mid level", "mid", "intermediate"],
  },
  { value: "Senior", terms: ["senior", "sr"] },
  { value: "Lead", terms: ["lead", "tech lead"] },
];

/** "staff" y "principal" son Lead solo junto a un rol técnico ("Staff Accountant" no lo es). */
const LEAD_NEEDS_ROLE = ["staff", "principal"];
const TECH_ROLE_WORDS = ["engineer", "developer", "architect", "scientist", "designer"];

/** Frases que contienen una palabra de nivel pero no son seniority. Se borran antes de buscar. */
const NOT_SENIORITY = ["lead generation", "lead gen", "leads", "mid market"];

function hasTerm(padded: string, term: string): boolean {
  return padded.includes(` ${term} `);
}

/**
 * Seniority a partir del título: "Trainee" < "Junior" < "Semi Senior" < "Senior" < "Lead".
 * Con varios niveles ("Junior/Mid") los devuelve en orden ascendente unidos con " / ".
 */
export function inferSeniorityFromTitle(title: string): string | null {
  let padded = ` ${foldText(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  for (const phrase of NOT_SENIORITY) padded = padded.split(` ${phrase} `).join(" ");
  // "semi senior" se consume entero para que no sume también "senior"
  const found: string[] = [];
  for (const level of LEVELS) {
    const leadByRole =
      level.value === "Lead" &&
      LEAD_NEEDS_ROLE.some((term) => hasTerm(padded, term)) &&
      TECH_ROLE_WORDS.some((word) => hasTerm(padded, word) || hasTerm(padded, `${word}s`));
    if (leadByRole || level.terms.some((term) => hasTerm(padded, term))) found.push(level.value);
    if (level.value === "Semi Senior") padded = padded.split(" semi senior ").join(" ");
  }
  return found.length ? found.join(" / ") : null;
}
