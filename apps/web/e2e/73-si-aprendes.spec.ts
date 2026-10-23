import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  E2E_USER_ID,
  deleteSeededPublicJobs,
  login,
  ownerDb,
  seedPublicJobs,
  seedTargetRoles,
  setSeedTargetRoles,
} from "./helpers";

/**
 * Flujo 73 (ronda 121, E3b): «Si aprendés…» en /plan. El usuario e2e queda con tres skills en el
 * plan y niveles conocidos, y el pool trae 12 avisos ficticios de una carrera que ningún otro spec
 * usa (soporte_it; la de muestra chica, product_marketing). Todo inventado y sin red.
 *
 * Cuentas del pool sembrado (cada aviso pide `sql`, nivel 2 de la persona, y una skill más):
 * - 6 avisos de sql + excel: ya le calzan (pre-score 9);
 * - 3 de power_bi (excluyente), 2 de tableau y 1 de python, con la persona en nivel 1 en esas tres:
 *   hoy dan 6 y con la skill a nivel 2 dan 9.
 * Los números absolutos dependen de que no haya otros avisos sueltos en la carrera, así que los
 * resultados se comparan contra el «hoy te calzan N de T» que muestra la misma página.
 *
 * `/plan` cachea el cálculo 30 minutos por persona y carrera (`?simular=` se combina afuera): por
 * eso las dos carreras son propias de este spec. En local, reiniciá `next dev` entre corridas.
 */
test.describe.configure({ mode: "serial" });

const CAREER = "soporte_it";
// `personas` siembra pool de rrhh_it: la muestra chica usa una carrera que ningún spec siembra
const FEW_CAREER = "product_marketing";
const LEVELS: Record<string, number> = { sql: 2, excel: 3, python: 1, power_bi: 1, tableau: 1 };
const PLAN: { slug: string; priority: number }[] = [
  { slug: "power_bi", priority: 3 },
  { slug: "tableau", priority: 2 },
  { slug: "python", priority: 1 },
];

type Seed = { title: string; skills: { slug: string; isMust: boolean }[] };

function pool(tag: number): Seed[] {
  const out: Seed[] = [];
  const add = (n: number, label: string, skills: Seed["skills"]) => {
    for (let i = 1; i <= n; i += 1) {
      out.push({ title: `Analista de Soporte IT Ficticio ${label}${i} ${tag}`, skills });
    }
  };
  add(6, "A", [
    { slug: "sql", isMust: true },
    { slug: "excel", isMust: false },
  ]);
  add(3, "B", [
    { slug: "sql", isMust: false },
    { slug: "power_bi", isMust: true },
  ]);
  add(2, "C", [
    { slug: "sql", isMust: false },
    { slug: "tableau", isMust: false },
  ]);
  add(1, "D", [
    { slug: "sql", isMust: false },
    { slug: "python", isMust: false },
  ]);
  return out;
}

async function axeSummary(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

/** «Hoy te calzan N de T ofertas» de la página: base para comparar la simulación. */
async function readToday(page: Page): Promise<{ now: number; total: number }> {
  const text = await page.getByTestId("plan-sim-hoy").innerText();
  const m = /Hoy te calzan (\d+) de (\d+) ofertas/.exec(text);
  if (!m) throw new Error("no se encontró «Hoy te calzan N de T ofertas»");
  return { now: Number(m[1]), total: Number(m[2]) };
}

test.describe("Flujo 73: si aprendés…", () => {
  const tag = Date.now();
  const fewTag = tag + 1;
  let originalRoles: Awaited<ReturnType<typeof seedTargetRoles>> | null = null;
  let levelsBackup: (typeof s.skillLevels.$inferSelect)[] = [];
  let planBackup: (typeof s.learningPlanItems.$inferSelect)[] = [];

  test.beforeAll(async () => {
    originalRoles = await seedTargetRoles();
    const slugs = Object.keys(LEVELS);
    const { db, close } = ownerDb();
    try {
      const skillRows = await db
        .select({ id: s.skills.id, slug: s.skills.slug })
        .from(s.skills)
        .where(inArray(s.skills.slug, slugs));
      if (skillRows.length !== slugs.length) throw new Error("faltan skills en la taxonomía");
      const idOf = new Map(skillRows.map((r) => [r.slug, r.id]));
      const ids = skillRows.map((r) => r.id);

      levelsBackup = await db
        .select()
        .from(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)));
      await db
        .delete(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)));
      await db.insert(s.skillLevels).values(
        slugs.map((slug) => ({
          userId: E2E_USER_ID,
          skillId: idOf.get(slug)!,
          level: LEVELS[slug]!,
          confidence: 0.8,
          state: "respaldada" as const,
        })),
      );

      planBackup = await db
        .select()
        .from(s.learningPlanItems)
        .where(eq(s.learningPlanItems.userId, E2E_USER_ID));
      await db.delete(s.learningPlanItems).where(eq(s.learningPlanItems.userId, E2E_USER_ID));
      await db.insert(s.learningPlanItems).values(
        PLAN.map((p) => ({
          userId: E2E_USER_ID,
          skillId: idOf.get(p.slug)!,
          priority: p.priority,
          status: "pendiente",
        })),
      );
    } finally {
      await close();
    }
    await seedPublicJobs(
      tag,
      pool(tag).map((p) => ({
        title: p.title,
        company: "Empresa Ficticia 1",
        sourceKind: "getonboard_api" as const,
        roleHints: [CAREER],
        skills: p.skills,
      })),
    );
    await setSeedTargetRoles({ targetRoles: [CAREER], targetRole: CAREER });
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    await deleteSeededPublicJobs(tag).catch(() => {});
    await deleteSeededPublicJobs(fewTag).catch(() => {});
    if (originalRoles) await setSeedTargetRoles(originalRoles).catch(() => {});
    const { db, close } = ownerDb();
    try {
      const skillRows = await db
        .select({ id: s.skills.id })
        .from(s.skills)
        .where(inArray(s.skills.slug, Object.keys(LEVELS)));
      await db
        .delete(s.skillLevels)
        .where(
          and(
            eq(s.skillLevels.userId, E2E_USER_ID),
            inArray(
              s.skillLevels.skillId,
              skillRows.map((r) => r.id),
            ),
          ),
        )
        .catch(() => {});
      if (levelsBackup.length) {
        await db
          .insert(s.skillLevels)
          .values(levelsBackup)
          .catch(() => {});
      }
      await db
        .delete(s.learningPlanItems)
        .where(eq(s.learningPlanItems.userId, E2E_USER_ID))
        .catch(() => {});
      if (planBackup.length) {
        await db
          .insert(s.learningPlanItems)
          .values(planBackup)
          .catch(() => {});
      }
    } finally {
      await close();
    }
  });

  test("a 1280 px una tabla con «+K ofertas» por skill y la ruta por semanas", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto("/plan");
    const table = page.getByTestId("plan-sim-tabla");
    await expect(table).toBeVisible();
    await expect(table.locator("caption")).toBeVisible();
    await expect(table.locator('th[scope="col"]').first()).toBeVisible();

    await expect(page.getByTestId("plan-sim-fila-power_bi")).toContainText("+3 ofertas");
    await expect(page.getByTestId("plan-sim-fila-power_bi")).toContainText("3 (3 excluyentes)");
    await expect(page.getByTestId("plan-sim-fila-tableau")).toContainText("+2 ofertas");
    await expect(page.getByTestId("plan-sim-fila-python")).toContainText("+1 oferta");
    // Las tarjetas son la versión angosta: a 1280 px no se ven
    await expect(page.getByTestId("plan-sim-tarjetas")).toBeHidden();

    const route = page.getByTestId("plan-ruta");
    await expect(route).toBeVisible();
    await expect(route.getByRole("listitem")).toHaveCount(3);
    await expect(route.getByRole("listitem").first()).toContainText("Semana 1");
    await expect(page.getByText(/Ofertas de los últimos 30 días, al \d{2}\/\d{2}\./)).toBeVisible();
    // «pre-score» solo aparece dentro de «Cómo se calcula»
    await expect(page.getByTestId("plan-sim")).not.toContainText(/pre-?score/i);
  });

  test("?simular= cambia el «pasan X de T» y el botón queda presionado", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto("/plan");
    const { now, total } = await readToday(page);
    expect(total).toBeGreaterThanOrEqual(12);
    await expect(page.getByTestId("plan-sim-resultado")).toHaveCount(0);

    // Con el botón (formulario GET, sin JS)
    await page.getByTestId("plan-sim-pick-power_bi").click();
    await expect(page).toHaveURL(/simular=power_bi/);
    await expect(page.getByTestId("plan-sim-resultado")).toContainText(
      `pasan ${now + 3} de ${total} ofertas`,
    );
    await expect(page.getByTestId("plan-sim-pick-power_bi")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("plan-sim-pick-tableau")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Por la URL, con un slug que no está en el plan (se descarta) y otro con forma inválida
    await page.goto("/plan?simular=power_bi,tableau,no_esta_en_el_plan,%3Cx%3E");
    await expect(page.getByTestId("plan-sim-resultado")).toContainText(
      `pasan ${now + 5} de ${total} ofertas`,
    );
    await expect(page.getByTestId("plan-sim-resultado")).not.toContainText("no_esta_en_el_plan");
    await expect(page.getByTestId("plan-sim-pick-power_bi")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("plan-sim-pick-tableau")).toHaveAttribute("aria-pressed", "true");
  });

  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    test(`a ${viewport.width} px no hay scroll horizontal y axe no encuentra violaciones`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await login(page);
      await page.goto("/plan?simular=power_bi,tableau");
      const narrow = viewport.width === 360;
      await expect(
        page.getByTestId(narrow ? "plan-sim-tarjeta-power_bi" : "plan-sim-fila-power_bi"),
      ).toBeVisible();
      await expect(page.getByTestId("plan-sim-resultado")).toBeVisible();
      if (narrow) {
        await expect(page.getByTestId("plan-sim-tabla")).toBeHidden();
        await expect(page.getByTestId("plan-sim-tarjeta-power_bi")).toContainText("+3 ofertas");
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width, "scrollWidth en /plan").toBeLessThanOrEqual(360);
        // Botones de al menos 44 px de alto
        const box = await page.getByTestId("plan-sim-pick-m-power_bi").boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      expect(await axeSummary(page), `Violaciones de axe en /plan a ${viewport.width} px`).toEqual(
        [],
      );
    });
  }

  test("con menos de 10 ofertas dice que todavía no puede decirlo", async ({ page }) => {
    await seedPublicJobs(
      fewTag,
      [1, 2, 3].map((i) => ({
        title: `Product Marketing Ficticio ${i} ${fewTag}`,
        company: "Empresa Ficticia 2",
        sourceKind: "getonboard_api" as const,
        roleHints: [FEW_CAREER],
        skills: [{ slug: "sql", isMust: true }],
      })),
    );
    await setSeedTargetRoles({ targetRoles: [FEW_CAREER], targetRole: FEW_CAREER });
    await page.setViewportSize({ width: 360, height: 740 });
    await login(page);
    await page.goto("/plan");
    const few = page.getByTestId("plan-sim-pocas");
    await expect(few).toContainText("Con pocas ofertas todavía no podemos decirlo");
    await expect(page.getByTestId("plan-sim-tabla")).toHaveCount(0);
    await expect(page.getByTestId("plan-sim-tarjetas")).toHaveCount(0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, "scrollWidth en /plan").toBeLessThanOrEqual(360);
    expect(await axeSummary(page), "Violaciones de axe en /plan con pocas ofertas").toEqual([]);
  });
});
