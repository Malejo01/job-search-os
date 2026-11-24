import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { E2E_EMAIL, E2E_PASSWORD, E2E_USER_ID, ownerDb } from "./helpers";

/**
 * Persona de prueba para los flujos que usan `login()` (R26-07). La base local no trae al usuario del seed
 * (lo crea `pnpm e2e:local:prepare`, que corre `db:seed:local`): sin él, `login()` cae en «Crear cuenta» y
 * los flujos que dependen de él fallan sin que haya ningún problema en la pantalla.
 *
 * `ensureSeedPerson()` crea, solo si no existe, una persona INVENTADA con las credenciales de `E2E_*` y la
 * deja con el onboarding completo y alta en `app_admins`. Es idempotente y no toca nada si el seed ya corrió
 * (todo con `onConflictDoNothing`): con el seed completo, los flujos ven lo mismo que antes. El que sea admin
 * en pantalla sigue dependiendo de `ADMIN_EMAILS` en el servidor (`e2e-local.mjs` lo fija al email e2e).
 */
export async function ensureSeedPerson(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: E2E_USER_ID,
        email: E2E_EMAIL,
        name: "Persona de prueba",
        passwordHash: hashPassword(E2E_PASSWORD),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: E2E_USER_ID,
        displayName: "Persona de prueba",
        locationCountry: "AR",
        inboundAddress: "u_qa_seed@ingest.test",
        profileSummary:
          "Perfil ficticio de la persona de prueba de los e2e. No corresponde a nadie real y solo existe en la base local.",
      })
      .onConflictDoNothing();
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, E2E_USER_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: E2E_USER_ID, version: 1, active: true, rules: {} as never });
    }
    await db.insert(s.appAdmins).values({ userId: E2E_USER_ID }).onConflictDoNothing();
  } finally {
    await close();
  }
}
