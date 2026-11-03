import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 113 (reserva R-3): barra de pestañas de abajo en el celular (P4), detrás de
 * MOBILE_TABBAR_ENABLED. Si está apagada no aparece y el «Menú» de arriba sigue igual; si está
 * prendida, cuatro pestañas con la activa marcada, sin tapar el chip de soporte.
 */
test.describe("Flujo 113: pestañas del celular (R-3)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("el «Menú» de arriba sigue estando (la guía y los e2e se anclan ahí)", async ({ page }) => {
    await login(page);
    await page.goto("/hoy");
    await expect(page.locator("summary").filter({ hasText: "Menú" }).first()).toBeVisible();
  });

  test("con la variable, cuatro pestañas, la activa marcada y el chip por encima", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const bar = page.getByTestId("tabbar");
    test.skip((await bar.count()) === 0, "MOBILE_TABBAR_ENABLED apagada en este servidor");
    await expect(bar.getByRole("link")).toHaveCount(4);
    await expect(bar.getByRole("link", { name: "Ofertas" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await bar.getByRole("link", { name: "Pendientes" }).click();
    await page.waitForURL("**/jobs/pending-jd");
    await expect(bar.getByRole("link", { name: "Pendientes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const chip = await page.getByRole("button", { name: "¿Algo no anduvo?" }).boundingBox();
    const barBox = await bar.boundingBox();
    expect(chip!.y + chip!.height).toBeLessThanOrEqual(barBox!.y);
    for (const tema of ["claro", "oscuro"]) {
      await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/hoy");
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations, tema).toEqual([]);
      expect(unmeasured, tema).toEqual([]);
    }
  });
});
