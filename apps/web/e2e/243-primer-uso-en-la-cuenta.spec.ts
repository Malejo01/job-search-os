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
 * Flujo 243 (R26-05): el recorrido de primer uso queda guardado en la cuenta (`profiles.primer_uso_visto`), no solo
 * en el navegador. Con la persona B (ficticia). Terminar el recorrido o saltearlo deja la versión vigente en su
 * perfil; mientras no lo termina, la columna sigue vacía. «Que no reaparezca en otro dispositivo» lo cubre el test
 * unitario de `shouldShowPrimerUso`: un navegador automatizado no muestra el recorrido salvo que se fuerce, y
 * forzar ignora lo de la cuenta a propósito (es lo que usa el flujo 186).
 */
async function savedInAccount(): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ seen: s.profiles.primerUsoVisto })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_B_USER_ID));
    return row?.seen ?? null;
  } finally {
    await close();
  }
}

async function resetAccount(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.profiles)
      .set({ primerUsoVisto: null })
      .where(eq(s.profiles.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

test.describe("Flujo 243: primer uso guardado en la cuenta (R26-05)", () => {
  test.beforeEach(async ({ page }) => {
    await ensureSecondUser();
    await resetAccount();
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("r26-05")) {
        localStorage.clear();
        sessionStorage.setItem("r26-05", "1");
      }
      localStorage.setItem("jso-primer-uso-forzar", "1");
    });
  });
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("al terminar el recorrido la cuenta lo guarda; antes, no", async ({ page }) => {
    await loginAsSecondUser(page);
    const dialog = page.getByTestId("primer-uso");
    await expect(dialog).toBeVisible();
    expect(await savedInAccount()).toBeNull();
    for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Siguiente" }).click();
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(savedInAccount).toBe("r23");
  });

  test("saltearlo también lo guarda en la cuenta", async ({ page }) => {
    await loginAsSecondUser(page);
    const dialog = page.getByTestId("primer-uso");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Saltar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(savedInAccount).toBe("r23");
  });
});
