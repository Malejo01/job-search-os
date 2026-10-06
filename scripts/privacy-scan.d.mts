export interface Pattern {
  id: number;
  source: string;
  /** Texto normalizado del patrón (o la regex). Nunca se imprime. */
  n: string;
  isRegex: boolean;
  re: RegExp;
}

/** `id: 0` es un hallazgo de ruta prohibida (lleva `why`). */
export interface Hit {
  where: string;
  id: number;
  why?: string;
}

export const REPO_ROOT: string;
export function norm(s: string): string;
export function loadPatterns(dir: string): Pattern[];
export function scanLine(pats: Pattern[], line: string): number[];
export function scanText(pats: Pattern[], label: string, text: string): Hit[];
export function scanDiff(
  pats: Pattern[],
  diff: string,
  prefix?: string,
): { hits: Hit[]; paths: string[] };
export function scanHistory(
  pats: Pattern[],
  revArgs: string[],
  root?: string,
): { hits: Hit[]; commits: number };
export function scanWorktree(pats: Pattern[], root?: string): { hits: Hit[]; base: string | null };
export function scanTree(pats: Pattern[], root?: string): { hits: Hit[]; files: number };
export function report(hits: Hit[], pats: Pattern[]): string;
export function main(argv?: string[]): Promise<void>;
