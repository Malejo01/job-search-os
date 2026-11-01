import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { ownerDb } from "./helpers";

test.describe("Flujo 95: Pedir acceso desde celular (360x740) para el 11/11", () => {
  const VIEWPORT = { width: 360, height: 740 };
  const tag = Date.now();
  const testEmail = `voces-jovenes-${tag}@example.com`;

  test.use({ viewport: VIEWPORT });

  test.afterAll(async () => {
    try {
      const { db, close } = ownerDb();
      try {
        await db.delete(s.waitlist).where(eq(s.waitlist.email, testEmail));
      } finally {
        await close();
      }
    } catch {
      // Ignorar si no se creó o si la base no estaba
    }
  });

  test("completado automático de origen=voces-jovenes, anotarse y ver confirmación", async ({
    page,
  }) => {
    await page.goto("/acceso?origen=voces-jovenes");
    await expect(page.getByRole("heading", { name: "Pedir acceso" })).toBeVisible();

    // Campo email con type y autocomplete correctos para teclado de celular
    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toHaveAttribute("type", "email");
    await expect(emailInput).toHaveAttribute("autocomplete", "email");

    // ¿Cómo te enteraste? precompletado con "Voces Jóvenes"
    const heardInput = page.getByLabel("¿Cómo te enteraste? (opcional)");
    await expect(heardInput).toHaveValue("Voces Jóvenes");

    // Botón de al menos 44 px de alto
    const submitBtn = page.getByRole("button", { name: "Pedir acceso" });
    const btnBox = await submitBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(btnBox!.height).toBeGreaterThanOrEqual(44);

    // Completar el formulario con una carrera de la beta (contaduría)
    await page.getByLabel("Nombre").fill("Tester Voces");
    await emailInput.fill(testEmail);
    await page.getByLabel("Carrera").selectOption("finanzas_contabilidad");

    await submitBtn.click();

    // Confirmación en simple sobre el 26/11 y sin prometer lugar (el cupo es limitado)
    const statusMsg = page.getByRole("status").filter({
      hasText: "La beta abre el jueves 26/11 y el cupo es limitado",
    });
    await expect(statusMsg).toBeVisible();
    await expect(statusMsg).toContainText("si hay lugar");
    await expect(statusMsg).not.toContainText("Te escribimos antes");
  });

  test("axe en claro (360x740) sin violaciones", async ({ page }) => {
    await page.goto("/acceso?origen=voces-jovenes");
    await expect(page.getByRole("heading", { name: "Pedir acceso" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const { violations, unmeasured } = await axeSummary(page);
    expect(violations, "Violaciones de axe en claro").toEqual([]);
    expect(unmeasured, "axe no midió el contraste en claro").toEqual([]);
  });

  test("axe en oscuro (360x740) sin violaciones", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("jso-tema", "oscuro"));
    await page.goto("/acceso?origen=voces-jovenes");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("heading", { name: "Pedir acceso" })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const { violations, unmeasured } = await axeSummary(page);
    expect(violations, "Violaciones de axe en oscuro").toEqual([]);
    expect(unmeasured, "axe no midió el contraste en oscuro").toEqual([]);
  });
});
