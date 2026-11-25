import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 256 (R27-04): Hoy saluda con la mascota la primera vez del día, y el día queda guardado en la cuenta
 * (`profiles.saludo_visto`): no vuelve el mismo día ni en un navegador nuevo, y vuelve al día siguiente.
 * Con la persona B (ficticia).
 */
async function saludoDeLaCuenta(): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ v: s.profiles.saludoVisto })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_B_USER_ID));
    return row?.v ?? null;
  } finally {
    await close();
  }
}

async function fijarSaludo(valor: string | null): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.profiles)
      .set({ saludoVisto: valor })
      .where(eq(s.profiles.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

test.describe("Flujo 256: saludo de la mascota en Hoy (R27-04)", () => {
  test.beforeEach(async () => {
    await ensureSecondUser();
    await fijarSaludo(null);
  });
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("saluda la primera vez, guarda el día en la cuenta y no vuelve ese día", async ({
    page,
    browser,
  }) => {
    await loginAsSecondUser(page);
    const saludo = page.getByTestId("mascota-saludo");
    await expect(saludo).toBeVisible();
    await expect(saludo.locator('[data-afi="saludando"]')).toBeVisible();
    await expect.poll(saludoDeLaCuenta).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Recargar el mismo día: no vuelve
    await page.reload();
    await expect(page.getByTestId("hoy-cabecera")).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("mascota-saludo")).toHaveCount(0);

    // Un navegador nuevo (sin localStorage) tampoco: lo recuerda la cuenta
    const otro = await browser.newContext();
    const otraPagina = await otro.newPage();
    await loginAsSecondUser(otraPagina);
    await expect(otraPagina.getByTestId("hoy-cabecera")).toBeVisible();
    await otraPagina.waitForTimeout(1200);
    await expect(otraPagina.getByTestId("mascota-saludo")).toHaveCount(0);
    await otro.close();
  });

  test("al día siguiente vuelve a saludar", async ({ page }) => {
    await fijarSaludo("2000-01-01");
    await loginAsSecondUser(page);
    await expect(page.getByTestId("mascota-saludo")).toBeVisible();
    await expect.poll(saludoDeLaCuenta).not.toBe("2000-01-01");
  });
});
