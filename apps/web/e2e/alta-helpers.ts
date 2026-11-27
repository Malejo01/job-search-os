import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { ownerDb } from "./helpers";

/**
 * Apoyo de los flujos 390 a 397 (R32, alta y apertura por carrera). Personas inventadas, creadas como dueño en la
 * base local y borradas al final. Nada llama a un modelo ni a un servicio de afuera.
 */

export type PersonaAlta = { id: string; email: string; password: string; name: string };

/** Una persona con onboarding completo y, a elección, sin carrera cargada (el caso de una cuenta vieja). */
export async function crearPersonaAlta(
  persona: PersonaAlta,
  opts: {
    targetRoles?: string[];
    careerOther?: string | null;
    careerAskedAt?: Date | null;
    newsEmail?: boolean;
  } = {},
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: persona.id,
        email: persona.email,
        name: persona.name,
        passwordHash: hashPassword(persona.password),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    const roles = opts.targetRoles ?? [];
    const values = {
      userId: persona.id,
      displayName: persona.name,
      locationCountry: "AR",
      inboundAddress: `u_alta_${persona.id.slice(-6)}@ingest.test`,
      profileSummary:
        "Perfil ficticio de una persona de los flujos de alta. No corresponde a nadie real y solo existe en la base local.",
      targetRoles: roles,
      targetRole: roles[0] ?? null,
      careerOther: opts.careerOther ?? null,
      careerAskedAt: opts.careerAskedAt ?? null,
      newsEmail: opts.newsEmail ?? true,
    };
    await db
      .insert(s.profiles)
      .values(values)
      .onConflictDoUpdate({ target: s.profiles.userId, set: values });
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, persona.id));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: persona.id, version: 1, active: true, rules: {} as never });
    }
  } finally {
    await close();
  }
}

export async function borrarPersonaAlta(id: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, id));
    await db.delete(s.profiles).where(eq(s.profiles.userId, id));
    await db.delete(s.users).where(eq(s.users.id, id));
  } finally {
    await close();
  }
}

export async function perfilDe(id: string) {
  const { db, close } = ownerDb();
  try {
    const [row] = await db.select().from(s.profiles).where(eq(s.profiles.userId, id));
    return row ?? null;
  } finally {
    await close();
  }
}

export async function entrarComo(page: Page, persona: PersonaAlta): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Contraseña").fill(persona.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/hoy**");
}
