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
 * Flujo 290 (R28-15): Afi habla. Hoy, Interview y «Armá tu CV» muestran a Afi con su burbuja de diálogo (el texto es
 * el contenido; la imagen es decorativa), y cada pantalla tiene un solo Afi (la cara del botón del asistente no
 * cuenta). Persona B (ficticia).
 */
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

/**
 * Los Afi que se ven en la pantalla, sin contar la cara del botón del asistente. Los de las ayudas «?» viven
 * dentro de un cuadro cerrado (`<details>`): están en el HTML pero no se ven, así que no cuentan.
 */
const AFIS = '[data-afi]:not([data-afi="cara"]):visible';

test.describe("Flujo 290: Afi que habla (R28-15)", () => {
  test.beforeEach(async () => {
    await ensureSecondUser();
  });
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("Hoy: la primera vez del día saluda animado y el resto del día habla quieto", async ({
    page,
  }) => {
    await fijarSaludo(null);
    await loginAsSecondUser(page);
    const saludo = page.getByTestId("mascota-saludo");
    await expect(saludo).toBeVisible();
    const dice = saludo.getByTestId("afi-dice");
    await expect(dice.getByTestId("afi-dice-burbuja")).toBeVisible();
    await expect(dice.getByTestId("afi-dice-texto")).toContainText("¡Hola");
    await expect(dice.locator('[data-afi="saludando"]')).toHaveCount(1);
    // Un solo Afi en toda la pantalla
    await expect(page.locator(AFIS)).toHaveCount(1);
    // La imagen es decorativa: el contenido es el texto
    await expect(dice.locator("img")).toHaveAttribute("alt", "");

    // Recargar el mismo día: Afi sigue ahí, quieto y sin el saludo
    await page.reload();
    const quieto = page.getByTestId("mascota-quieto").getByTestId("afi-dice");
    await expect(quieto).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId("mascota-saludo")).toHaveCount(0);
    await expect(quieto.getByTestId("afi-dice-texto")).not.toContainText("¡Hola");
    await expect(quieto.getByTestId("afi-dice-texto")).toContainText(/ofertas?|Hoy no hay/);
    await expect(quieto.locator('[data-afi="quieto"]')).toHaveCount(1);
    await expect(quieto.locator("[data-afi-animado]")).toHaveCount(0);
    await expect(page.locator(AFIS)).toHaveCount(1);
  });

  test("Interview: la portada tiene a Afi hablando con el botón para empezar en la burbuja", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    const res = await page.goto("/interview");
    test.skip(res?.status() === 404, "Interview no está disponible en este entorno");
    const dice = page.getByTestId("afi-dice-interview");
    await expect(dice).toBeVisible();
    await expect(dice.locator('[data-afi="hablando-1"]')).toHaveCount(1);
    await expect(dice.getByTestId("afi-dice-interview-texto")).toContainText(
      "te voy a entrevistar. Elegí una oferta y practicamos.",
    );
    const empezar = dice.getByRole("link", { name: "Empezar" });
    await expect(empezar).toHaveAttribute("href", "#interview-empezar");
    await empezar.click();
    await expect(page).toHaveURL(/#interview-empezar$/);
    await expect(page.locator(AFIS)).toHaveCount(1);
  });

  test("Armá tu CV: Afi explica con su burbuja", async ({ page }) => {
    await loginAsSecondUser(page);
    const res = await page.goto("/cv/armar");
    test.skip(res?.status() === 404, "el chat «Armá tu CV» está apagado en este entorno");
    const dice = page.getByTestId("afi-dice-cv-armar");
    await expect(dice).toBeVisible();
    await expect(dice.locator('[data-afi="explicando"]')).toHaveCount(1);
    await expect(dice.getByTestId("afi-dice-cv-armar-texto")).toContainText("paso a paso");
  });
});
