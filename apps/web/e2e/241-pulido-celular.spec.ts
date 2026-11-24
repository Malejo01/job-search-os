import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_B_USER_ID, loginAsSecondUser, ownerDb, removeSecondUser } from "./helpers";
import { cleanB, openInterview, prepareB } from "./voz-helpers";

/**
 * Flujo 241 (R26-05): pulido del celular. La mascota del asistente (persona B, tester) no tapa lo que se escribe
 * ni se repite, y el aviso de vencimiento en Hoy queda dentro del margen.
 * - Con el foco en un campo de texto, a 390 px la mascota se esconde; al salir del campo vuelve. En escritorio
 *   no se esconde.
 * - «Preguntame lo que quieras» sale una sola vez por navegador (antes, por sesión): una pestaña nueva del mismo
 *   navegador ya no lo ve.
 * - El aviso de vencimiento (solo con `PRICING_ENABLED=1`, como el flujo 160) no queda pegado al borde.
 */
const mascot = (page: Page) => page.getByTestId("asistente-mascota");

test.describe("Flujo 241: pulido del celular (R26-05)", () => {
  test.afterAll(async () => {
    await cleanB();
    await removeSecondUser().catch(() => {});
  });

  test("a 390 px la mascota se esconde mientras se escribe y vuelve al salir del campo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await prepareB("Simulación ficticia del pulido");
    await openInterview(page, id);
    await expect(mascot(page)).toBeVisible();
    await page.getByTestId("interview-answer").click();
    await expect(mascot(page)).toBeHidden();
    // El contador de la pregunta sigue a la vista
    await expect(page.getByTestId("interview-progress-label")).toBeVisible();
    await page.getByTestId("interview-answer").blur();
    await expect(mascot(page)).toBeVisible();
  });

  test("en escritorio la mascota no se esconde al escribir", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const id = await prepareB("Simulación ficticia del pulido");
    await openInterview(page, id);
    await page.getByTestId("interview-answer").click();
    await expect(mascot(page)).toBeVisible();
  });

  test("el aviso inicial sale una sola vez por navegador, no una por sesión", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const first = await context.newPage();
      await loginAsSecondUser(first);
      await first.goto("/hoy");
      await expect(first.getByTestId("asistente-aviso-inicial")).toBeVisible();
      // Otra pestaña del mismo navegador: la sesión es nueva, el navegador es el mismo
      const second = await context.newPage();
      await second.goto("/jobs");
      await expect(mascot(second)).toBeVisible();
      await second.waitForTimeout(1500);
      await expect(second.getByTestId("asistente-aviso-inicial")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("el aviso de vencimiento en Hoy queda dentro del margen, no pegado al borde", async ({
    page,
  }) => {
    test.skip(process.env.PRICING_ENABLED !== "1", "necesita PRICING_ENABLED=1 en el servidor");
    await prepareB("Simulación ficticia del pulido");
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({
          plan: "lista",
          planSource: "pago",
          planUntil: new Date(Date.now() + 2 * 86_400_000),
        })
        .where(eq(s.profiles.userId, E2E_B_USER_ID));
    } finally {
      await close();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsSecondUser(page);
    const aviso = page.getByTestId("aviso-plan");
    await expect(aviso).toBeVisible();
    const box = await aviso.boundingBox();
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(12);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390 - 12);
  });
});
