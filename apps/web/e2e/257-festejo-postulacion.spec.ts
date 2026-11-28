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
 * Flujo 257 (R27-04): al marcar una postulación como enviada, Afi festeja con un aviso en la esquina que no
 * bloquea la pantalla, se cierra con su botón y no vuelve al recargar. Con la persona B (ficticia).
 */
async function ofertaSinPostular(tag: string): Promise<string> {
  const data = await seedSecondUserData(tag);
  const { db, close } = ownerDb();
  try {
    await db.delete(s.applications).where(eq(s.applications.userId, E2E_B_USER_ID));
    await db.update(s.jobs).set({ status: "evaluada" }).where(eq(s.jobs.id, data.jobId));
  } finally {
    await close();
  }
  return data.jobId;
}

test.describe("Flujo 257: festejo al enviar una postulación (R27-04)", () => {
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("festeja una vez, se cierra con el botón y no vuelve al recargar", async ({ page }) => {
    const jobId = await ofertaSinPostular("257");
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("festejo")).toHaveCount(0);

    await page.getByRole("button", { name: "Ya me postulé" }).click();
    const festejo = page.getByTestId("festejo");
    await expect(festejo).toBeVisible();
    await expect(festejo).toHaveAttribute("data-festejo", "postulacion");
    await expect(festejo.locator('[data-afi="motivacion"]')).toBeAttached();
    // No es un diálogo: no bloquea ni tapa la pantalla
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Botón de cerrar de 44 px con nombre accesible
    const cerrar = page.getByRole("button", { name: "Cerrar el aviso" });
    const caja = await cerrar.boundingBox();
    expect(caja?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
    await cerrar.click();
    await expect(festejo).toHaveCount(0);

    // Recargar no lo repite: la postulación ya estaba enviada al entrar
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId("festejo")).toHaveCount(0);
  });
});
