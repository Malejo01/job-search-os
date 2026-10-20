import { expect, test } from "@playwright/test";
import {
  E2E_USER_ID,
  backupSeedCriteria,
  login,
  restoreSeedCriteria,
  seedTargetRoles,
  setSeedTargetRoles,
  skillLevelsOf,
  type CriteriaBackup,
} from "./helpers";

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

    // Una skill del rol que el usuario e2e todavía no tiene (el seed carga varias)
    const rows = await page.locator('[data-testid^="skill-"]').evaluateAll((els) =>
      els.map((el) => ({
        slug: (el.getAttribute("data-testid") ?? "").replace(/^skill-/, ""),
        name: el.querySelector("legend")?.textContent?.trim() ?? "",
      })),
    );
    const free = rows.find((r) => r.slug !== "" && r.name !== "" && !(r.slug in before));
    expect(free, "el rol tiene al menos una skill sin nivel para el usuario e2e").toBeDefined();
    const { slug, name } = free!;

    try {
      await page
        .getByTestId(`skill-${slug}`)
        .getByLabel("lo uso con soltura", { exact: true })
        .check();
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await page.waitForURL("**/settings/skills?guardado=1");
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      // Solo se suma esa skill: las demás filas viajan con el nivel que ya tenían
      expect(await skillLevelsOf(E2E_USER_ID)).toEqual({ ...before, [slug]: 3 });

      await page.getByRole("button", { name: `Quitar ${name}`, exact: true }).click();
      await page.waitForURL("**/settings/skills?guardado=1");
      await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
      expect(await skillLevelsOf(E2E_USER_ID)).toEqual(before);
    } finally {
      // Si el test falló a mitad, no deja el nivel de prueba guardado
      const current = await skillLevelsOf(E2E_USER_ID);
      if (slug in current && !(slug in before)) {
        await page.goto("/settings/skills?rol=fullstack");
        await page.getByRole("button", { name: `Quitar ${name}`, exact: true }).click();
        await page.waitForURL("**/settings/skills?guardado=1");
      }
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
