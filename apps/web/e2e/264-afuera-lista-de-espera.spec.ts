import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { ownerDb } from "./helpers";
import { MASCOTA_ALT } from "../lib/mascota";

/**
 * Flujo 264 (R27-06): al anotarte en la lista de espera aparece Afi trabajando, un solo Afi y quieto.
 * Y la confirmación sigue sin violaciones de axe. Se limpian las filas de prueba (`example.com`).
 */
test.describe("Flujo 264: lista de espera con Afi trabajando", () => {
  const tag = Date.now();

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(like(s.waitlist.email, `afi-${tag}-%@example.com`));
    } finally {
      await close();
    }
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`la confirmación muestra a Afi trabajando, sin axe serio (${tema})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      if (tema === "oscuro") {
        await page.addInitScript(() => localStorage.setItem("jso-tema", "oscuro"));
      }
      await page.goto("/acceso");
      // Antes de anotarse no hay Afi en el formulario
      await expect(page.locator("[data-afi]")).toHaveCount(0);
      await page.getByLabel("Nombre").fill("Persona Prueba");
      await page.getByLabel("Email").fill(`afi-${tag}-${tema}@example.com`);
      await page.getByRole("radio", { name: "Abogacía" }).check();
      await page.getByRole("button", { name: "Pedir acceso", exact: true }).click();
      await expect(page.getByTestId("acceso-confirmacion")).toBeVisible();
      const afi = page.getByRole("img", { name: MASCOTA_ALT.trabajando });
      await expect(afi).toBeVisible();
      await expect(page.locator("[data-afi]")).toHaveCount(1);
      await expect(page.locator("[data-afi]")).toHaveAttribute("data-afi", "trabajando");
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
    });
  }
});
