/** Puntaje desde el que una oferta cuenta como «buena» en «Qué portal te sirve». */
export const HIGH_SCORE = 7;

/** Rótulos de los portales de email y de las fuentes del pool (mismos textos que `SOURCE_LABELS` de la web). */
const POOL_LABELS: Record<string, string> = {
  hn_whoishiring: "HN Who is hiring",
  remotive: "Remotive",
  remoteok: "Remote OK",
  jobicy: "Jobicy",
  himalayas: "Himalayas",
  wwr: "We Work Remotely",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  teamtailor: "Teamtailor",
};

/** Grupo («portal») de una oferta según su primera fuente. Pura. */
export function sourceGroupOf(kind: string, sourceName: string | null): string {
  switch (kind) {
    case "email_linkedin":
      return "LinkedIn";
    case "email_generic":
      return sourceName?.trim().toLowerCase() === "indeed (email)" ? "Indeed" : "Email";
    case "email_getonboard":
    case "getonboard_api":
      return "Get on Board";
    case "manual":
      return "Cargadas por vos";
    default:
      return POOL_LABELS[kind] ?? "Otra";
  }
}

export type PortalStatsInput = {
  group: string;
  /** Puntaje de la última evaluación; null = sin evaluar. */
  score: number | null;
  applied: boolean;
  interview: boolean;
};

export type PortalStatsRow = {
  group: string;
  total: number;
  highScore: number;
  applied: number;
  interview: number;
  /** Menos de `minForStats` ofertas: la UI dice «pocos datos» y no muestra porcentajes. */
  fewData: boolean;
};

/** Cuenta por grupo, de mayor a menor total (empate: por nombre). Pura. */
export function portalStatsRows(
  rows: readonly PortalStatsInput[],
  opts: { minForStats: number },
): PortalStatsRow[] {
  const byGroup = new Map<string, PortalStatsRow>();
  for (const r of rows) {
    const acc = byGroup.get(r.group) ?? {
      group: r.group,
      total: 0,
      highScore: 0,
      applied: 0,
      interview: 0,
      fewData: false,
    };
    acc.total += 1;
    if (r.score !== null && r.score >= HIGH_SCORE) acc.highScore += 1;
    if (r.applied) acc.applied += 1;
    if (r.interview) acc.interview += 1;
    byGroup.set(r.group, acc);
  }
  return [...byGroup.values()]
    .map((r) => ({ ...r, fewData: r.total < opts.minForStats }))
    .sort((a, b) => b.total - a.total || a.group.localeCompare(b.group));
}
