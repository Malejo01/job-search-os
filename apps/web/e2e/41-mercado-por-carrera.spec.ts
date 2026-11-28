import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { E2E_USER_ID, deleteSeededPublicJobs, login, ownerDb } from "./helpers";

/**
 * Flujo 41 (ronda 58, reescrito en la R34-03): mercado de la carrera en /market. Desde la R34-03 la pantalla es
 * el mercado mínimo: una sola página para la carrera de la persona, sin selector de otras carreras ni «Tu agenda».
 * Avisos ficticios sembrados por base: ~25 de QA y 3 de Marketing digital. Sin red.
 *
 * En producción el pool de cada carrera se cachea 30 minutos; el servidor de los e2e lo lee sin caché
 * (`MARKET_POOL_CACHE=off`), así la siembra de acá se ve. Igual se verifica la estructura, no números exactos:
 * el pool puede traer avisos de otros specs.
 * Los cálculos (vigente, tomable, habilidades que ya tiene, sueldos por moneda) los prueban los unitarios de
 * `market-minimal.test.ts`; la estructura mínima, el flujo 452. Etiquetas de `ROLE_SKILLS`: QA = «QA».
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 41: mercado de la carrera", () => {
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

  test("«Mercado de QA» con las pestañas de sus puestos, sin «Tu agenda» ni selector de carreras", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/market");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mercado de QA");
    await expect(page.getByRole("navigation", { name: "Puestos" })).toBeVisible();
    // R34-03: lo que se sacó de la pantalla
    await expect(page.getByRole("heading", { name: "Tu agenda de skills" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Explorar otra carrera" })).toHaveCount(0);
    await expect(page.getByTestId("role-market")).toHaveCount(0);
  });

  // Antes `?carrera=` exploraba otra carrera (con aviso de muestra chica y los dos mercados de sueldo). Con el
  // mercado mínimo es solo la carrera de la persona: ese caso ya no tiene sentido y se reemplaza por este.
  test("?carrera= ya no explora otras carreras: la pantalla sigue en la de la persona", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/market?carrera=marketing_digital");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mercado de QA");
    await expect(page.getByTestId("career-market")).toHaveCount(0);
  });

  // Se miden los bloques, no la página: la barra de navegación ya desborda a 360 px (revisión UX de la 58).
  test("a 360 px los bloques del mercado no desbordan", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page);
    await page.goto("/market");
    for (const id of [
      "market-ofertas",
      "market-habilidades",
      "market-modalidad",
      "market-sueldos",
    ]) {
      const block = page.getByTestId(id);
      await expect(block).toBeVisible();
      const box = await block.boundingBox();
      expect(box && box.x + box.width <= 360, `${id} entra en 360 px`).toBe(true);
      expect(await block.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  });

  test("accesibilidad: cada bloque con su título y cada barra con su número en texto", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/market");
    for (const [id, title] of [
      ["market-ofertas", "Cuántas ofertas hay hoy"],
      ["market-habilidades", "Qué habilidades piden más"],
      ["market-modalidad", "En qué modalidad y desde dónde"],
      ["market-sueldos", "Qué sueldos se publican"],
    ] as const) {
      await expect(page.getByTestId(id).getByRole("heading", { level: 2 })).toHaveText(title);
    }

    // Las filas de habilidades, sin depender de cuáles: el caché puede traer avisos que sembró otro spec. Con
    // pocos avisos (menos de 10) no hay gráfico y no hay filas; con 10 o más, cada fila dice su número en
    // texto y si la persona ya la tiene, y tiene una sola barra decorativa que no se anuncia.
    if ((await page.getByTestId("market-pocos").count()) === 0) {
      const rows = page
        .getByTestId("market-habilidades")
        .getByRole("listitem")
        .filter({ hasText: /· \d+ de \d+ ofertas \(\d+ %\) · (Ya la tenés|No la tenés) cargada/ });
      await expect(rows.first()).toBeVisible();
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).locator('[aria-hidden="true"]')).toHaveCount(1);
      }
    }
  });
});
