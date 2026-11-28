import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, ownerDb } from "./helpers";

/**
 * Flujo 428 (R33-01, C-01, C-02, C-04): los estados de «Tu CV». Persona B (tester, con la puerta de dos
 * caminos). Sin historial: solo «Tengo CV» y «No tengo CV». Con un trabajo cargado: la puerta desaparece,
 * aparece «Seguir armando mi CV» y cada faltante con su botón al campo exacto. El estado «completo» (con
 * resumen) se prueba en `cv-screen.test.ts`: el resumen solo se escribe confirmándolo en el asistente.
 * Datos inventados; el historial de la persona se borra al empezar y al terminar.
 */
test.describe.configure({ mode: "serial" });

async function cleanHistory() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

// La persona B no existe hasta que un spec la crea: sin esto el login vuelve a /login?error=1
test.beforeAll(async () => {
  await ensureSecondUser();
  await cleanHistory();
});
test.afterAll(cleanHistory);

test.describe("Flujo 428: Tu CV con tres estados", () => {
  test("sin nada de historial: la puerta con los dos caminos", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/cv");
    const door = page.getByTestId("cv-door");
    await expect(door.getByRole("link", { name: "Tengo CV", exact: true })).toBeVisible();
    await expect(door.getByRole("link", { name: "No tengo CV", exact: true })).toBeVisible();
    await expect(page.getByTestId("cv-seguir")).toHaveCount(0);
    await expect(page.getByTestId("cv-completo")).toHaveCount(0);
  });

  test("con un trabajo cargado: «Seguir armando mi CV» y cada faltante con su botón", async ({
    page,
  }) => {
    const { db, close } = ownerDb();
    try {
      await db.insert(s.careerHistory).values({
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa A",
        title: "Analista de Pruebas",
        startMonth: "2022-03",
        bullets: ["Armé reportes semanales para el equipo"],
        sort: 0,
      });
    } finally {
      await close();
    }
    await loginAsSecondUser(page);
    await page.goto("/cv");
    await expect(page.getByTestId("cv-door")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Seguir armando mi CV" })).toBeVisible();

    const faltan = page.getByTestId("cv-faltantes");
    await expect(faltan).toContainText("Lo que falta para un CV completo");
    await expect(faltan).not.toContainText("tu experiencia laboral");
    await expect(faltan.getByRole("link", { name: "Escribir mi resumen" })).toHaveAttribute(
      "href",
      "/cv/armar",
    );
    // «Agregar mis estudios» cae en el campo exacto del formulario de estudios
    const estudios = faltan.getByRole("link", { name: "Agregar mis estudios" });
    await expect(estudios).toHaveAttribute(
      "href",
      /\/settings\/historial\?tipo=educacion#nueva-organization/,
    );
    await estudios.click();
    await page.waitForURL(/\/settings\/historial\?tipo=educacion/);
    await expect(page.locator("#nueva-kind")).toHaveValue("educacion");
  });

  test("360 px: sin desborde horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginAsSecondUser(page);
    await page.goto("/cv");
    const { scrollWidth, ancho } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      ancho: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(ancho);
  });
});
