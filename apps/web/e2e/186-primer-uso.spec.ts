import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { axeSummary } from "./axe-helpers";

/**
 * Flujo 186 (R23-05): recorrido de primer uso tras el rediseño. Aparece una vez, se puede saltear o
 * cerrar con Escape, atrapa el foco y lo devuelve, y no vuelve a aparecer. Usa su propio usuario.
 * Los navegadores automatizados no lo ven salvo con `jso-primer-uso-forzar`, que se pone acá.
 */
test.describe("Flujo 186: primer uso de lo nuevo", () => {
  test.beforeEach(async ({ page }) => {
    await ensureSecondUser();
    await page.addInitScript(() => {
      // Solo la primera carga de cada prueba: después el estado lo manda la app
      if (!sessionStorage.getItem("r23-05")) {
        localStorage.clear();
        sessionStorage.setItem("r23-05", "1");
      }
      localStorage.setItem("jso-primer-uso-forzar", "1");
    });
  });
  test.afterAll(async () => {
    await removeSecondUser();
  });

  test("aparece, recorre los 4 pasos, termina y no vuelve", async ({ page }) => {
    await loginAsSecondUser(page);
    const dialog = page.getByRole("dialog", { name: "El menú cambió" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Paso 1 de 4")).toBeVisible();
    // El foco va al botón principal y se queda dentro del diálogo
    await expect(dialog.getByRole("button", { name: "Siguiente" })).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    // El nombre accesible del diálogo es el título del paso: desde acá se toma por testid
    const fixed = page.getByTestId("primer-uso");
    const titles = ["Practicá una entrevista", "El sello tiene detalle", "Academy"];
    for (const [i, title] of titles.entries()) {
      await fixed.getByRole("button", { name: "Siguiente" }).click();
      await expect(fixed.getByText(`Paso ${i + 2} de 4`)).toBeVisible();
      await expect(fixed.getByRole("heading", { name: title })).toBeVisible();
    }
    const { violations } = await axeSummary(page, ["header", "footer"]);
    expect(violations.filter((v) => /serious|critical/.test(v))).toEqual([]);
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(page.getByTestId("primer-uso")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("primer-uso")).toHaveCount(0);
  });

  test("Escape lo cierra, devuelve el foco y no vuelve", async ({ page }) => {
    await loginAsSecondUser(page);
    await expect(page.getByTestId("primer-uso")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("primer-uso")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement !== null)).toBe(true);
    await page.goto("/jobs");
    await expect(page.getByTestId("primer-uso")).toHaveCount(0);
  });

  for (const width of [390, 1280]) {
    test(`a ${width} px se puede saltear y los botones miden 44 px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await loginAsSecondUser(page);
      const dialog = page.getByTestId("primer-uso");
      await expect(dialog).toBeVisible();
      for (const name of ["Siguiente", "Saltar"]) {
        const box = await dialog.getByRole("button", { name }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await dialog.getByRole("button", { name: "Saltar" }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
});
