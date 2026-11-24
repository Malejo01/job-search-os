import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 259 (R27-04): con `prefers-reduced-motion`, el festejo sale con Afi quieto (sin transform animado) y
 * el aviso se va solo. Con la persona B (ficticia).
 */
test.use({ reducedMotion: "reduce" });

test.describe("Flujo 259: festejo con movimiento reducido (R27-04)", () => {
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("Afi queda quieto y el aviso se va solo", async ({ page }) => {
    const data = await seedSecondUserData("259");
    const { db, close } = ownerDb();
    try {
      await db.delete(s.applications).where(eq(s.applications.userId, E2E_B_USER_ID));
      await db.update(s.jobs).set({ status: "evaluada" }).where(eq(s.jobs.id, data.jobId));
    } finally {
      await close();
    }
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${data.jobId}`);
    await page.getByRole("button", { name: "Marcar aplicada" }).click();
    const festejo = page.getByTestId("festejo");
    await expect(festejo).toBeVisible();
    // Quieto: la variante reducida no lleva transform animado
    const animado = festejo.locator("[data-afi-animado]");
    await expect(animado).toHaveAttribute("data-movimiento", "reducido");
    const transform = await animado.evaluate((el) => getComputedStyle(el).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
    // Se va solo (7 s)
    await expect(festejo).toHaveCount(0, { timeout: 12_000 });
  });
});
