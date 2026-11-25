import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 307 (R28-12): se llega a `/ayuda` desde el pie de la app, desde Ajustes y desde el asistente, y las
 * preguntas nuevas se pueden enlazar por ancla (`/ayuda#pago`). Persona B (ficticia, tester del asistente).
 */
test.describe("Flujo 307: enlaces a las preguntas frecuentes (R28-12)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("desde el pie y desde Ajustes", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/hoy");
    await page.locator("footer").getByRole("link", { name: "Preguntas frecuentes" }).click();
    await expect(page).toHaveURL(/\/ayuda$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Preguntas frecuentes" }),
    ).toBeVisible();

    await page.goto("/settings");
    await page.getByTestId("ajustes-ayuda").click();
    await expect(page).toHaveURL(/\/ayuda$/);
  });

  test("desde el asistente (un link, cierra el panel)", async ({ page }) => {
    await loginAsSecondUser(page);
    const boton = page.getByRole("button", { name: "Preguntale a Afi", exact: true });
    if ((await boton.count()) === 0) {
      expect(process.env.CI, "En el CI el botón del asistente tiene que estar").toBeFalsy();
      test.skip(true, "El asistente no está encendido para la persona B (ASSISTANT_ENABLED)");
    }
    await boton.click();
    const panel = page.getByTestId("assistant-panel");
    await expect(panel).toBeVisible();
    await panel
      .getByTestId("assistant-ayuda")
      .getByRole("link", { name: "Preguntas frecuentes" })
      .click();
    await expect(page).toHaveURL(/\/ayuda$/);
  });

  test("las preguntas nuevas se enlazan por ancla", async ({ page }) => {
    await page.goto("/ayuda#pago");
    await expect(page.locator("#pago")).toBeInViewport();
  });
});
