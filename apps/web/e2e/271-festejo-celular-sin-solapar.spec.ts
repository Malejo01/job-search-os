import * as s from "@job-search-os/db/schema";
import { expect, test, type Locator } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 271 (R28-01): a 390 px el aviso del festejo no se superpone con la barra de navegación de abajo ni con
 * el botón del asistente, y entra en el ancho de la pantalla. Persona B (ficticia, tester: ve el asistente).
 * `reducedMotion: "reduce"`: con la animación de escala la caja del aviso miente a mitad de camino.
 */
test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });

type Caja = { x: number; y: number; width: number; height: number };

async function caja(l: Locator): Promise<Caja | null> {
  if ((await l.count()) === 0) return null;
  return l.first().boundingBox();
}

const seSuperponen = (a: Caja, b: Caja): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("Flujo 271: festejo en el celular (R28-01)", () => {
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("a 390 px el aviso no tapa la barra de abajo ni el botón del asistente", async ({
    page,
  }) => {
    const data = await seedSecondUserData("271");
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

    const aviso = await caja(festejo);
    expect(aviso, "el aviso tiene caja").not.toBeNull();
    if (!aviso) return;
    // Dentro del ancho de la pantalla
    expect(aviso.x).toBeGreaterThanOrEqual(0);
    expect(aviso.x + aviso.width).toBeLessThanOrEqual(390);
    expect(aviso.y).toBeGreaterThanOrEqual(0);

    // La barra de abajo (en el detalle de una oferta no se muestra: ahí se compara solo si existe)
    const barra = await caja(page.getByTestId("tabbar"));
    if (barra) expect(seSuperponen(aviso, barra), "el aviso tapa la barra de abajo").toBe(false);

    // El botón del asistente (si el asistente no está encendido no hay nada que tapar)
    const asistente = await caja(page.getByTestId("asistente-mascota"));
    if (asistente) {
      expect(seSuperponen(aviso, asistente), "el aviso tapa el botón del asistente").toBe(false);
    } else {
      expect(process.env.CI, "En el CI el botón del asistente tiene que estar").toBeFalsy();
    }

    // El botón de cerrar sigue al alcance (44 px) y a la vista
    const cerrar = await caja(page.getByTestId("festejo-cerrar"));
    expect(cerrar).not.toBeNull();
    expect(cerrar?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(cerrar?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
