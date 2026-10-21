import { skillLevels, skills } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  E2E_USER_ID,
  backupSeedCriteria,
  login,
  ownerDb,
  restoreSeedCriteria,
  seedTargetRoles,
  setSeedTargetRoles,
  skillLevelsOf,
  type CriteriaBackup,
} from "./helpers";

type SkillLevelRow = typeof skillLevels.$inferSelect;

/** Fila completa de `skill_levels` del usuario e2e para un slug, o null si no tiene nivel. */
async function skillLevelRow(slug: string): Promise<SkillLevelRow | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ level: skillLevels })
      .from(skillLevels)
      .innerJoin(skills, eq(skills.id, skillLevels.skillId))
      .where(and(eq(skillLevels.userId, E2E_USER_ID), eq(skills.slug, slug)));
    return row?.level ?? null;
  } finally {
    await close();
  }
}

/** Deja la fila como estaba antes del test: la vuelve a insertar tal cual o la borra si no existía. */
async function restoreSkillLevelRow(slug: string, backup: SkillLevelRow | null): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const [skill] = await db.select({ id: skills.id }).from(skills).where(eq(skills.slug, slug));
    if (!skill) return;
    await db
      .delete(skillLevels)
      .where(and(eq(skillLevels.userId, E2E_USER_ID), eq(skillLevels.skillId, skill.id)));
    if (backup) await db.insert(skillLevels).values(backup);
  } finally {
    await close();
  }
}

/**
 * Flujo 52 (ronda 77): los formularios que se envían con `GuardedForm` no muestran un error falso
 * cuando el guardado sale bien (el redirect de éxito no es un fallo) y, cuando la acción sí rechaza,
 * dejan el aviso junto al campo, el foco ahí y lo cargado intacto. Datos inventados; criterios,
 * niveles y puestos del usuario e2e se restauran.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 52a: criterios", () => {
  let backup: CriteriaBackup = [];
  let ready = false;

  test.beforeAll(async () => {
    backup = await backupSeedCriteria();
    ready = true;
  });
  test.afterAll(async () => {
    if (ready) await restoreSeedCriteria(backup);
  });

  test("guardar bien lleva a saved=1 sin aviso de error", async ({ page }) => {
    await login(page);
    await page.goto("/settings/criteria");
    await page.getByRole("button", { name: "Guardar como versión nueva", exact: true }).click();
    await page.waitForURL("**/settings/criteria?saved=1");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });
});

test.describe("Flujo 52b: skills de Ajustes", () => {
  test("guardar un nivel y quitarlo no muestran error falso ni tocan otros niveles", async ({
    page,
  }) => {
    const before = await skillLevelsOf(E2E_USER_ID);
    await login(page);
    await page.goto("/settings/skills?rol=fullstack");

    const rowLocator = page.locator('[data-testid^="skill-"]');
    await rowLocator.first().waitFor();
    const rows = await rowLocator.evaluateAll((els) =>
      els.map((el) => ({
        slug: (el.getAttribute("data-testid") ?? "").replace(/^skill-/, ""),
        name: el.querySelector("legend")?.textContent?.trim() ?? "",
      })),
    );
    const named = rows.filter((r) => r.slug !== "" && r.name !== "");
    // Mejor una skill sin nivel; si el seed ya las cargó todas, la primera fila, que se respalda
    // completa (nivel, confianza y estado) y se restaura al final
    const target = named.find((r) => !(r.slug in before)) ?? named[0];
    expect(target, "el rol muestra al menos una skill").toBeDefined();
    const { slug, name } = target!;
    const backup = await skillLevelRow(slug);
    const prev = before[slug];
    const [label, level] = prev === 3 ? ["lo usé en un proyecto", 2] : ["lo uso con soltura", 3];
    const withoutTarget = Object.fromEntries(Object.entries(before).filter(([k]) => k !== slug));

    try {
      await page.getByTestId(`skill-${slug}`).getByLabel(label, { exact: true }).check();
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.waitForURL("**/settings/skills?guardado=1");
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      // Solo cambia esa skill: las demás filas viajan con el nivel que ya tenían
      expect(await skillLevelsOf(E2E_USER_ID)).toEqual({ ...before, [slug]: level });

      await page.getByRole("button", { name: `Quitar ${name}`, exact: true }).click();
      await page.waitForURL("**/settings/skills?guardado=1");
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      expect(await skillLevelsOf(E2E_USER_ID)).toEqual(withoutTarget);
    } finally {
      await restoreSkillLevelRow(slug, backup);
    }
  });
});

test.describe("Flujo 52c: puestos", () => {
  let original: { targetRoles: string[]; targetRole: string | null } | null = null;

  test.beforeAll(async () => {
    original = await seedTargetRoles();
    await setSeedTargetRoles({ targetRoles: ["qa"], targetRole: "qa" });
  });
  test.afterAll(async () => {
    if (original) await setSeedTargetRoles(original);
  });

  test("sin ningún puesto marcado: error junto al campo, foco en la primera casilla, nada guardado", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings#puesto");
    const section = page.locator("#puesto");
    const boxes = section.locator('input[name="targetRoles"]');
    const qa = section.locator('input[name="targetRoles"][value="qa"]');
    await qa.uncheck();
    await expect(section.getByTestId("role-picker-count")).toHaveText(/^0 de \d+/);

    await section.getByRole("button", { name: "Guardar puestos", exact: true }).click();
    await expect(section.getByRole("alert")).toContainText("Elegí al menos un puesto");
    await expect(boxes.first()).toBeFocused();
    await expect(boxes.first()).toHaveAttribute("aria-invalid", "true");
    // Lo que se veía sigue igual y la base no cambió
    await expect(section.getByTestId("role-picker-count")).toHaveText(/^0 de \d+/);
    expect((await seedTargetRoles()).targetRoles).toEqual(["qa"]);

    // Marcar uno y guardar: sale bien, sin aviso de error
    await qa.check();
    await section.getByRole("button", { name: "Guardar puestos", exact: true }).click();
    await page.waitForURL("**/settings?puesto=guardado**");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });
});
