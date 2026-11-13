import { schema as s } from "@job-search-os/db";
import {
  applyGapCardToHistory,
  detectGaps,
  gapCareerKey,
  profileAgentAllowed,
  profileAgentMode,
  type GapHistoryRow,
  type GapSkillRow,
  type GapTopicRef,
  type HistoryInput,
  type ProfileGapCard,
} from "@job-search-os/pipeline";
import { and, asc, eq, sql } from "drizzle-orm";
import { withUser } from "../db";
import { invalidateUserInsights } from "../insights-cache";
import { saveSkillLevels } from "../skill-levels";

/**
 * Parte de servidor de la etapa de huecos del agente de perfil (ADR-034, R10-3). Todo con `withUser` (RLS):
 * los huecos se calculan acá, a partir de lo que ya está en la base, no del estado que manda el navegador. La
 * charla no se guarda: solo se escribe lo que la persona confirma con el clic sobre una tarjeta.
 */

/** ¿Esta persona ve el agente? Falla cerrado: sin email o ante un error de la consulta, no. */
export async function profileAgentAllowedFor(userId: string): Promise<boolean> {
  // Sin el flag (o sin `CV_IMPORT_ENABLED=1`) ni se consulta la base
  if (process.env.CV_IMPORT_ENABLED !== "1" || profileAgentMode(process.env) === "off") {
    return false;
  }
  try {
    const [me] = await withUser(userId, (tx) =>
      tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
    );
    return profileAgentAllowed(process.env, me?.email);
  } catch {
    return false;
  }
}

export type GapContext = {
  career: string;
  history: GapHistoryRow[];
  skills: GapSkillRow[];
  gaps: GapTopicRef[];
};

const isLevel = (n: number): n is 0 | 1 | 2 | 3 => n === 0 || n === 1 || n === 2 || n === 3;

/** Historial, skills y carrera de la persona, y los huecos que salen de eso. */
export async function loadGapContext(userId: string): Promise<GapContext> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId))
      .orderBy(asc(s.careerHistory.sort), asc(s.careerHistory.createdAt));
    const history: GapHistoryRow[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind as GapHistoryRow["kind"],
      organization: r.organization,
      title: r.title,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      bullets: r.bullets,
    }));
    const levels = await tx
      .select({ slug: s.skills.slug, name: s.skills.name, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(eq(s.skillLevels.userId, userId))
      .orderBy(asc(s.skills.name));
    const skills: GapSkillRow[] = levels.flatMap((l) =>
      isLevel(l.level) ? [{ slug: l.slug, name: l.name, level: l.level }] : [],
    );
    const [profile] = await tx
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    return {
      career: gapCareerKey(profile?.targetRoles ?? []),
      history,
      skills,
      gaps: detectGaps(history, skills),
    };
  });
}

export type SaveGapResult =
  { ok: true } | { ok: false; reason: "not_found" | "invalid"; field?: string };

/**
 * Aplica una tarjeta confirmada. La tarjeta que vuelve del navegador ya se validó con el esquema y el filtro
 * de sensibles en la ruta; acá se la aplica con la misma validación que la carga manual (`validateHistory`).
 * Las viñetas se suman con un lock por persona (el mismo del historial), así dos confirmaciones a la vez no
 * pisan una a la otra.
 */
export async function saveGapCard(userId: string, card: ProfileGapCard): Promise<SaveGapResult> {
  if (card.field === "skill_level") {
    if (card.slug === null) return { ok: false, reason: "not_found" };
    const slug = card.slug;
    // Solo una skill de la taxonomía que la persona ya tiene: un `slug` desconocido se descarta (O6)
    const [mine] = await withUser(userId, (tx) =>
      tx
        .select({ level: s.skillLevels.level })
        .from(s.skillLevels)
        .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
        .where(and(eq(s.skillLevels.userId, userId), eq(s.skills.slug, slug)))
        .limit(1),
    );
    if (!mine) return { ok: false, reason: "not_found" };
    await saveSkillLevels(userId, [{ slug, level: card.level }]);
    invalidateUserInsights(userId);
    return { ok: true };
  }
  return withUser(userId, async (tx): Promise<SaveGapResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 25))`);
    const [row] = await tx
      .select()
      .from(s.careerHistory)
      .where(and(eq(s.careerHistory.id, card.historyId), eq(s.careerHistory.userId, userId)))
      .limit(1);
    if (!row || row.kind !== "trabajo") return { ok: false, reason: "not_found" };
    const current: HistoryInput = {
      kind: "trabajo",
      organization: row.organization,
      title: row.title,
      startMonth: row.startMonth,
      endMonth: row.endMonth,
      bullets: row.bullets,
    };
    const next = applyGapCardToHistory(current, card);
    if (!next.ok) return { ok: false, reason: "invalid", field: next.error };
    await tx
      .update(s.careerHistory)
      .set({
        startMonth: next.value.startMonth,
        endMonth: next.value.endMonth,
        bullets: next.value.bullets,
        updatedAt: new Date(),
      })
      .where(and(eq(s.careerHistory.id, row.id), eq(s.careerHistory.userId, userId)));
    return { ok: true };
  });
}
