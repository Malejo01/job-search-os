import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 128 (R5-C8): en el selector de «Tus puestos» las 8 carreras de la beta van primero, en su
 * propio grupo y con el nombre del anuncio; el resto queda debajo, bajo «Otras carreras». Las
 * carreras no se repiten entre grupos.
 */
const BETA_NAMES = [
  "Abogacía",
  "Contaduría",
  "Administración",
  "Comunicación",
  "Marketing",
  "Relaciones públicas",
  "Relaciones internacionales y comex",
  "Programación",
];

test.describe("Flujo 128: las 8 carreras de la beta primero en los catálogos", () => {
  test("Ajustes › Tus puestos: grupo de la beta primero, con sus nombres, y «Otras carreras» debajo", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings");
    const section = page.locator("#puesto");
    const groups = section.getByRole("group");
    await expect(groups.first()).toHaveAccessibleName("Carreras de la beta");

    const beta = groups.first().locator('input[name="targetRoles"]');
    await expect(beta).toHaveCount(8);
    const text = await groups.first().innerText();
    for (const name of BETA_NAMES) expect(text).toContain(name);

    await expect(section.getByText("Otras carreras", { exact: true })).toBeVisible();
    // Ninguna carrera sale dos veces
    const values = await section
      .locator('input[name="targetRoles"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(new Set(values).size).toBe(values.length);
  });

  test("Skills: «Skills sugeridas» abre con la beta y sigue «Otras carreras»", async ({ page }) => {
    await login(page);
    await page.goto("/settings/skills");
    const nav = page.getByRole("navigation", { name: "Puesto de las sugerencias" });
    await expect(nav.getByRole("heading", { level: 2, name: "Skills sugeridas" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Programación" })).toBeVisible();
    await expect(nav.getByText("Otras carreras", { exact: true })).toBeVisible();
  });
});
