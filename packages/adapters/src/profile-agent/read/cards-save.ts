import { schema as s, type Db } from "@job-search-os/db";
import {
  HISTORY_MAX_ENTRIES,
  MAX_CUSTOM_SKILLS,
  customSkillKey,
  type AcceptedCard,
} from "@job-search-os/pipeline";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

/**
 * Guardado de las tarjetas aceptadas (ADR-034 §2, R10-2). Todo en la transacción que abre quien llama,
 * que tiene que ser la de la persona con RLS (`withUser`, rol `jobsearch_app`, `app.user_id` fijado): acá
 * nunca se abre una conexión propia ni se usa el rol dueño. Las tarjetas ya pasaron `reviewCardDecisions`
 * (esquema estricto, filtro de datos sensibles, validación de `career_history`); lo que se vuelve a
 * comprobar acá es lo que depende de la base: los `slug` contra `skills` (O6), los topes de 20 entradas y
 * 30 skills propias bajo lock, y los duplicados.
 *
 * Lo que se guarda es lo mismo que guardan las pantallas manuales:
 * - experiencia y estudio → `career_history` con `source = 'cv'` y el mismo lock (25) que la carga manual
 *   y el chat de CV, para que dos guardados a la vez no pasen el tope;
 * - skill de la taxonomía → `skill_levels` (confianza 0,5, `sin_evidencia`, como `saveSkillLevels`);
 * - skill propia → `user_skills` (lock y tope de `saveCustomSkills`);
 * - inglés con CEFR → `profiles.english_cefr`.
 * El resumen del perfil no se toca. Otros idiomas no se guardan (no hay tabla: ADR-026 §4).
 */
export type CardsTx = Pick<Db, "select" | "insert" | "update" | "execute">;

export type CardSaveStatus =
  | "saved"
  | "updated"
  | "unchanged"
  | "duplicate"
  | "limit"
  | "slug_unknown"
  | "no_profile"
  | "preview_only";

export type CardSaveResult = { id: string; status: CardSaveStatus };

const historyKey = (i: {
  kind: string;
  organization: string;
  title: string;
  startMonth: string | null;
}) => [i.kind, i.organization, i.title, i.startMonth ?? ""].map(customSkillKey).join("|");

export async function saveAcceptedCards(
  tx: CardsTx,
  userId: string,
  cards: readonly AcceptedCard[],
): Promise<CardSaveResult[]> {
  const out = new Map<string, CardSaveStatus>();
  const set = (id: string, status: CardSaveStatus) => out.set(id, status);

  // 1. Historial (experiencia y estudios)
  const history = cards.filter(
    (c): c is Extract<AcceptedCard, { kind: "history" }> => c.kind === "history",
  );
  if (history.length > 0) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 25))`);
    const rows = await tx
      .select({
        kind: s.careerHistory.kind,
        organization: s.careerHistory.organization,
        title: s.careerHistory.title,
        startMonth: s.careerHistory.startMonth,
        sort: s.careerHistory.sort,
      })
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId))
      .orderBy(asc(s.careerHistory.sort));
    const have = new Set(rows.map(historyKey));
    let count = rows.length;
    let sort = rows.reduce((top, r) => Math.max(top, r.sort), -1);
    for (const c of history) {
      const key = historyKey(c.input);
      if (have.has(key)) {
        set(c.id, "duplicate");
        continue;
      }
      if (count >= HISTORY_MAX_ENTRIES) {
        set(c.id, "limit");
        continue;
      }
      sort += 1;
      count += 1;
      have.add(key);
      await tx.insert(s.careerHistory).values({
        userId,
        kind: c.input.kind,
        organization: c.input.organization,
        title: c.input.title,
        startMonth: c.input.startMonth,
        endMonth: c.input.endMonth,
        bullets: [...c.input.bullets],
        source: "cv",
        sort,
      });
      set(c.id, "saved");
    }
  }

  // 2. Skills de la taxonomía: el slug se compara con `skills` (O6); el que no está no se guarda
  const skills = cards.filter(
    (c): c is Extract<AcceptedCard, { kind: "skill" }> => c.kind === "skill",
  );
  if (skills.length > 0) {
    const known = await tx
      .select({ id: s.skills.id, slug: s.skills.slug })
      .from(s.skills)
      .where(inArray(s.skills.slug, [...new Set(skills.map((k) => k.slug))]));
    const idOf = new Map(known.map((k) => [k.slug, k.id]));
    const values: {
      userId: string;
      skillId: string;
      level: number;
      confidence: number;
      state: "sin_evidencia";
    }[] = [];
    const byId = new Map<string, string[]>();
    for (const k of skills) {
      const skillId = idOf.get(k.slug);
      if (!skillId) {
        set(k.id, "slug_unknown");
        continue;
      }
      // Dos tarjetas de la misma skill: queda la última (el nivel más reciente que eligió la persona)
      const prev = values.findIndex((v) => v.skillId === skillId);
      if (prev >= 0) values.splice(prev, 1);
      values.push({ userId, skillId, level: k.level, confidence: 0.5, state: "sin_evidencia" });
      byId.set(skillId, [...(byId.get(skillId) ?? []), k.id]);
    }
    if (values.length > 0) {
      const before = await tx
        .select({ skillId: s.skillLevels.skillId, level: s.skillLevels.level })
        .from(s.skillLevels)
        .where(
          and(
            eq(s.skillLevels.userId, userId),
            inArray(
              s.skillLevels.skillId,
              values.map((v) => v.skillId),
            ),
          ),
        );
      const prior = new Map(before.map((b) => [b.skillId, b.level]));
      await tx
        .insert(s.skillLevels)
        .values(values)
        .onConflictDoUpdate({
          target: [s.skillLevels.userId, s.skillLevels.skillId],
          set: { level: sql`excluded.level`, updatedAt: sql`now()` },
          setWhere: sql`${s.skillLevels.level} <> excluded.level`,
        });
      for (const v of values) {
        const was = prior.get(v.skillId);
        const status: CardSaveStatus =
          was === undefined ? "saved" : was === v.level ? "unchanged" : "updated";
        for (const id of byId.get(v.skillId) ?? []) set(id, status);
      }
    }
  }

  // 3. Skills propias (`user_skills`): mismo lock y tope de 30 que `saveCustomSkills`
  const custom = cards.filter(
    (c): c is Extract<AcceptedCard, { kind: "custom_skill" }> => c.kind === "custom_skill",
  );
  if (custom.length > 0) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}::text))`);
    const rows = await tx
      .select({ name: s.userSkills.name })
      .from(s.userSkills)
      .where(eq(s.userSkills.userId, userId));
    const have = new Set(rows.map((r) => customSkillKey(r.name)));
    let count = rows.length;
    for (const c of custom) {
      const key = customSkillKey(c.name);
      if (have.has(key)) {
        set(c.id, "duplicate");
        continue;
      }
      if (count >= MAX_CUSTOM_SKILLS) {
        set(c.id, "limit");
        continue;
      }
      have.add(key);
      count += 1;
      await tx
        .insert(s.userSkills)
        .values({ userId, name: c.name, level: c.level })
        .onConflictDoNothing();
      set(c.id, "saved");
    }
  }

  // 4. Idiomas: el inglés con nivel al perfil (la última tarjeta gana); el resto, solo vista previa
  const english = cards.filter(
    (c): c is Extract<AcceptedCard, { kind: "english" }> => c.kind === "english",
  );
  if (english.length > 0) {
    const last = english[english.length - 1]!;
    const changed = await tx
      .update(s.profiles)
      .set({ englishCefr: last.cefr, updatedAt: sql`now()` })
      .where(
        and(
          eq(s.profiles.userId, userId),
          sql`${s.profiles.englishCefr} is distinct from ${last.cefr}`,
        ),
      )
      .returning({ userId: s.profiles.userId });
    let status: CardSaveStatus = changed.length > 0 ? "updated" : "unchanged";
    if (changed.length === 0) {
      const [p] = await tx
        .select({ userId: s.profiles.userId })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1);
      if (!p) status = "no_profile";
    }
    for (const c of english) set(c.id, status);
  }
  for (const c of cards) if (c.kind === "language_preview") set(c.id, "preview_only");

  return cards.map((c) => ({ id: c.id, status: out.get(c.id) ?? "unchanged" }));
}
