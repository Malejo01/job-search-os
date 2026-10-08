import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 18 (JS-095): Ajustes muestra la dirección de email entrante y «Generar una dirección
 * nueva» la cambia, con confirmación en dos pasos (sin diálogo del navegador).
 */
test.describe("Flujo 18: dirección de email entrante por usuario", () => {
  test("Ajustes muestra la dirección y rotarla la cambia", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    const direccion = page.getByTestId("inbound-address");
    await expect(direccion).toHaveText(/^u_.+@.+/);
    const antes = await direccion.innerText();

    // Paso 1: el botón de confirmar no se ve hasta abrir el desplegable
    const confirmar = page.getByRole("button", { name: "Sí, generar una dirección nueva" });
    await expect(confirmar).toBeHidden();
    await page.getByText("Generar una dirección nueva", { exact: true }).click();
    await expect(confirmar).toBeVisible();

    // Paso 2: confirmar
    await confirmar.click();
    await expect(page).toHaveURL(/\/settings\?direccion=/);
    if (page.url().endsWith("direccion=sin_dominio")) {
      // Entorno sin INGEST_DOMAIN: avisa y no cambia nada
      await expect(page.getByRole("main").getByRole("alert")).toContainText("dominio de ingesta");
      await expect(direccion).toHaveText(antes);
      return;
    }
    await expect(page.getByRole("main").getByRole("status")).toContainText("La anterior ya no");
    await expect(direccion).not.toHaveText(antes);
    await expect(direccion).toHaveText(/^u_[a-z2-7]{20}@/);
  });

  test("Ajustes enlaza a los criterios", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await expect(
      page.getByRole("link", { name: "Editar mis criterios de evaluación" }),
    ).toHaveAttribute("href", "/settings/criteria");
  });
});
