import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";

/**
 * Flujo 276 (R28-03): los ítems que se sumaron al checklist de apertura (términos del PR legal, voz en el
 * servidor, ruteo a Claude, fecha definitiva). Cada uno sale como listo o pendiente, los pendientes dicen
 * qué hacer y en qué doc, y la pantalla nunca muestra el valor de una variable. Con el usuario del seed
 * (admin en el e2e, como el flujo 161).
 */
const IDS = ["terminos", "voz", "ruteo_claude", "fecha_definitiva"] as const;

test.describe("Flujo 276: checklist de apertura al día (R28-03)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  test.beforeAll(async () => {
    await ensureSeedPerson();
  });

  test("los ítems nuevos están, los pendientes dicen qué hacer y dónde, y no hay valores de variables", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/apertura");
    await expect(page.getByTestId("apertura-resumen")).toContainText(/listos|Todo listo/);
    for (const id of IDS) {
      const row = page.getByTestId(`apertura-${id}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-estado", /^(listo|pendiente)$/);
      if ((await row.getAttribute("data-estado")) === "pendiente") {
        await expect(row).toContainText("Qué hacer:");
        await expect(row).toContainText("docs/");
      }
    }
    // La versión de los términos del código no tiene el PR legal: nunca ✓ por defecto
    await expect(page.getByTestId("apertura-terminos")).toContainText("#552");
    // El servidor de e2e corre con la voz en «testers»: no es «all», queda pendiente
    await expect(page.getByTestId("apertura-voz")).toHaveAttribute("data-estado", "pendiente");
    // La fecha del código es provisoria hasta que se confirme
    await expect(page.getByTestId("apertura-fecha_definitiva")).toHaveAttribute(
      "data-estado",
      "pendiente",
    );
    await expect(page.locator("main")).not.toContainText(/mpago\.la|re_[A-Za-z0-9]{8}|@example\./);
  });
});
