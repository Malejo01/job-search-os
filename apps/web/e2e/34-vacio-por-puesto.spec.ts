import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";
import { E2E_USER_ID, deleteSeededPublicJobs, login, ownerDb, seedPublicJobs } from "./helpers";

/**
 * Flujo 34 (ronda 46): explicar el vacío por puesto. El usuario e2e de siempre (sin pasar por el
 * paso 1) elige Ciberseguridad (ningún otro spec lo siembra), tiene «senior» en su filtro de títulos y el pool solo trae dos avisos
 * de ese puesto con «Senior» en el título: /jobs dice por qué no hay ofertas y lleva a los
 * criterios. Al terminar se restauran los puestos y los criterios. Todo inventado, sin red.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 34: vacío por puesto", () => {
  const tag = Date.now();
  let original: {
    targetRole: string | null;
    targetRoles: string[];
    criteriaId: string;
    rules: unknown;
  } | null = null;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [profile] = await db
        .select({ targetRole: s.profiles.targetRole, targetRoles: s.profiles.targetRoles })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      const [crit] = await db
        .select({ id: s.evaluationCriteria.id, rules: s.evaluationCriteria.rules })
        .from(s.evaluationCriteria)
        .where(
          and(eq(s.evaluationCriteria.userId, E2E_USER_ID), eq(s.evaluationCriteria.active, true)),
        )
        .orderBy(desc(s.evaluationCriteria.version))
        .limit(1);
      if (!profile || !crit) throw new Error("el usuario e2e necesita perfil y criterios activos");
      original = {
        targetRole: profile.targetRole,
        targetRoles: profile.targetRoles,
        criteriaId: crit.id,
        rules: crit.rules,
      };
      const rules = crit.rules as { title_blocklist?: string[] };
      const blocklist = rules.title_blocklist ?? [];
      await db
        .update(s.evaluationCriteria)
        .set({
          rules: {
            ...rules,
            title_blocklist: blocklist.includes("senior") ? blocklist : [...blocklist, "senior"],
          } as never,
        })
        .where(eq(s.evaluationCriteria.id, crit.id));
      await db
        .update(s.profiles)
        .set({ targetRole: "ciberseguridad", targetRoles: ["ciberseguridad"] })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
    await seedPublicJobs(tag, [
      {
        title: `Senior Analista de Ciberseguridad Ficticio A ${tag}`,
        company: "Empresa Ficticia 1",
        sourceKind: "getonboard_api",
        roleHints: ["ciberseguridad"],
      },
      {
        title: `Senior Analista de Ciberseguridad Ficticio B ${tag}`,
        company: "Empresa Ficticia 2",
        sourceKind: "remoteok",
        roleHints: ["ciberseguridad"],
      },
    ]);
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    await deleteSeededPublicJobs(tag).catch(() => {});
    if (!original) return;
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ targetRole: original.targetRole, targetRoles: original.targetRoles })
        .where(eq(s.profiles.userId, E2E_USER_ID))
        .catch(() => {});
      await db
        .update(s.evaluationCriteria)
        .set({ rules: original.rules as never })
        .where(eq(s.evaluationCriteria.id, original.criteriaId))
        .catch(() => {});
    } finally {
      await close();
    }
  });

  test("/jobs explica que todas las ofertas del puesto piden Senior y lleva a los criterios", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const gaps = page.getByTestId("role-gaps");
    await expect(gaps).toContainText("Puestos sin ofertas");
    await expect(gaps).toContainText(/Hay 2 ofertas de Ciberseguridad: todas piden Senior/);
    await expect(gaps.getByRole("link", { name: "Revisá tus criterios" })).toHaveAttribute(
      "href",
      "/settings/criteria",
    );
  });
});
