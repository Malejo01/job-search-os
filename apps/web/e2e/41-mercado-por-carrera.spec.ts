import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { E2E_USER_ID, deleteSeededPublicJobs, login, ownerDb } from "./helpers";

/**
 * Flujo 41 (ronda 58): mercado por carrera en /market. Arriba «Mercado de <carrera>» (la de la
 * pestaña o la que se explora con ?carrera=) y debajo «Tu agenda». Avisos ficticios sembrados por
 * base: ~25 de QA y 3 de Marketing digital. Sin red.
 *
 * El servidor cachea 30 minutos el mercado de cada carrera, y otros specs ya pueden haber visitado
 * /market con QA antes de esta siembra. Por eso con QA solo se verifica la estructura (títulos y
 * orden), nunca números. Los números y las barras se prueban con Marketing digital, que ningún
 * otro spec visita: la primera lectura ocurre acá, ya con los datos sembrados.
 * Etiquetas de `ROLE_SKILLS`: QA = «QA», marketing_digital = «Marketing digital», ux_ui = «UX/UI».
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 41: mercado por carrera", () => {
  const tag = Date.now();
  let original: { targetRole: string | null; targetRoles: string[] } | null = null;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [profile] = await db
        .select({ targetRole: s.profiles.targetRole, targetRoles: s.profiles.targetRoles })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      if (!profile) throw new Error("el usuario e2e necesita perfil");
      original = profile;
      await db
        .update(s.profiles)
        .set({ targetRole: "qa", targetRoles: ["qa", "ux_ui"] })
        .where(eq(s.profiles.userId, E2E_USER_ID));

      const now = new Date();
      const known = await db
        .select({ id: s.skills.id, slug: s.skills.slug })
        .from(s.skills)
        .where(inArray(s.skills.slug, ["testing", "sql", "jira"]));
      const skillId = new Map(known.map((k) => [k.slug, k.id]));
      if (skillId.size !== 3) throw new Error("faltan skills de la taxonomía en la base e2e");

      const seniorities = ["Junior", "Semi Senior", "Senior", null, "Lead"];
      const modalities = ["remoto", "hibrido", "presencial", "remoto", "desconocida"] as const;
      const rows: { role: string; i: number }[] = [
        ...Array.from({ length: 25 }, (_, i) => ({ role: "qa", i })),
        ...Array.from({ length: 3 }, (_, i) => ({ role: "marketing_digital", i: 100 + i })),
      ];
      for (const { role, i } of rows) {
        const title = `Oferta Ficticia ${role} ${tag} ${i}`;
        const url = `https://example.com/e2e-pool/${tag}/${i}-${role}`;
        const [row] = await db
          .insert(s.publicJobs)
          .values({
            sourceKind: i % 2 === 0 ? "remoteok" : "jobicy",
            // Mismo prefijo que usa la limpieza de helpers.ts
            externalId: `e2e-pool-${tag}-${role}-${i}`,
            sourceName: i % 2 === 0 ? "Remote OK" : "Jobicy",
            sourceUrl: url,
            canonicalUrl: url,
            title,
            titleNormalized: title.toLowerCase(),
            companyRaw: `Empresa Ficticia ${i}`,
            companyNormalized: `empresa ficticia ${i}`,
            locationRaw: "Remoto (Anywhere in the World)",
            modality: modalities[i % modalities.length],
            seniority: seniorities[i % seniorities.length],
            salaryMinUsd: i % 4 === 0 ? 1500 : null,
            salaryMaxUsd: i % 4 === 0 ? 2500 : null,
            salaryPeriod: i % 4 === 0 ? "mensual" : null,
            jdText:
              i % 3 === 0
                ? `Descripción ficticia ${i} (${tag}). Inglés avanzado (excluyente).`
                : `Descripción ficticia ${i} (${tag}): equipo remoto.`,
            jdHash: `e2e-pool-${tag}-${role}-${i}`,
            roleHints: [role],
            postedAt: now,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .returning({ id: s.publicJobs.id });
        await db
          .insert(s.publicJobSkills)
          .values([
            { publicJobId: row!.id, skillId: skillId.get("testing")!, isMust: true },
            { publicJobId: row!.id, skillId: skillId.get("sql")!, isMust: i % 2 === 0 },
            ...(i % 3 === 0
              ? [{ publicJobId: row!.id, skillId: skillId.get("jira")!, isMust: false }]
              : []),
          ]);
      }
    } finally {
      await close();
    }
  });

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
    } finally {
      await close();
    }
  });

  test("arriba el mercado de la carrera del puesto y debajo «Tu agenda»", async ({ page }) => {
    await login(page);
    await page.goto("/market");
    const section = page.getByRole("region", { name: /^Mercado de QA/ });
    await expect(section).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Puestos" })).toBeVisible();
    const agenda = page.getByRole("heading", { name: "Tu agenda" });
    await expect(agenda).toBeVisible();
    await expect(page.getByTestId("role-market")).toBeVisible();

    const top = await section.boundingBox();
    const below = await agenda.boundingBox();
    expect(top && below && top.y < below.y, "el mercado de la carrera va arriba de Tu agenda").toBe(
      true,
    );
  });

  test("explorar otra carrera: ?carrera=, encabezado y aviso de muestra chica", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/market");
    await page
      .getByRole("combobox", { name: "Explorar otra carrera" })
      .selectOption({ label: "Marketing digital" });
    await page.getByRole("form", { name: "Explorar otra carrera" }).getByRole("button").click();
    await page.waitForURL(/carrera=marketing_digital/);

    await expect(page.getByRole("heading", { name: "Mercado de Marketing digital" })).toBeVisible();
    const section = page.getByTestId("career-market");
    await expect(section.getByRole("note").filter({ hasText: "Muestra chica" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Sueldos publicados" })).toBeVisible();
    await expect(section).toContainText("Muy pocas ofertas informan sueldo");
    // «Tu agenda» sigue en el puesto de la persona
    await expect(page.getByRole("heading", { name: "Tu agenda" })).toBeVisible();
    await expect(page.getByTestId("role-market")).toContainText("QA");
  });

  // Se mide el bloque nuevo y no la página: la barra de navegación ya desborda a 360 px desde
  // antes de esta ronda (revisión UX de la 58) y eso va en un ticket aparte.
  test("a 360 px el mercado de la carrera no desborda", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page);
    await page.goto("/market?carrera=marketing_digital");
    const section = page.getByTestId("career-market");
    await expect(section).toBeVisible();
    const box = await section.boundingBox();
    expect(box && box.x + box.width <= 360, "el bloque entra en 360 px").toBe(true);
    expect(await section.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("accesibilidad: sección con nombre, select con label y barras con su texto", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/market?carrera=marketing_digital");
    // Nombre completo: «Tu agenda» tiene otra región, «Mercado del rol», que un /^Mercado de/ también toma
    const section = page.getByRole("region", { name: /^Mercado de Marketing digital/ });
    await expect(section).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Explorar otra carrera" })).toBeVisible();

    const row = section.getByRole("listitem").filter({ hasText: /Testing automatizado/ });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/3 de 3 ofertas \(100 %\)/);
    await expect(row).toContainText(/3 excluyente/);
    await expect(row).not.toContainText(/0 deseable/);
    // La barra es decorativa: no se anuncia
    await expect(row.locator('[aria-hidden="true"]')).toHaveCount(1);
  });
});
