import { expect, test } from "@playwright/test";
import { afiBoton, entrarYBuscarBoton } from "./afi-helpers";
import { ensureSecondUser, removeSecondUser } from "./helpers";
import { expectFocusInside, expectFocusTrapped, reach } from "./teclado-helpers";

/**
 * Flujo 296 (R28-08): el panel del asistente solo con teclado. Se llega con Tab al botón, Enter lo abre con el
 * foco en el campo, el foco queda atrapado, Esc y el botón «Cerrar» lo cierran y el foco vuelve al botón.
 * El panel tiene una región `aria-live` para anunciar las respuestas. Persona B (tester del asistente); si el
 * asistente no está encendido, se saltea (en el CI es error).
 */
test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Flujo 296: asistente con teclado (R28-08)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("abre con Enter, atrapa el foco y al cerrar con Esc o «Cerrar» el foco vuelve al botón", async ({
    page,
  }) => {
    const boton = await entrarYBuscarBoton(page);
    await page.goto("/hoy");
    await reach(page, boton, "Preguntale a Afi");
    await page.keyboard.press("Enter");

    const panel = page.getByTestId("assistant-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleName(/\S/);
    // Al abrir, el foco va al campo de la pregunta
    await expect(panel.locator("textarea")).toBeFocused();
    // Anuncios: hay una región en vivo dentro del panel
    expect(await panel.locator("[aria-live], [role='status'], [role='log']").count()).toBeGreaterThan(
      0,
    );
    await expectFocusTrapped(page, panel);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(afiBoton(page), "con Esc, el foco vuelve al botón").toBeFocused();

    // Otra vez, y ahora con el botón «Cerrar» y Enter
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    const cerrar = panel.getByRole("button", { name: "Cerrar", exact: true });
    await reach(page, cerrar, "Cerrar");
    await expectFocusInside(panel, "en «Cerrar»");
    await page.keyboard.press("Enter");
    await expect(panel).toBeHidden();
    await expect(afiBoton(page), "con «Cerrar», el foco vuelve al botón").toBeFocused();
  });
});
