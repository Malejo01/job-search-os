import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, ownerDb } from "./helpers";

/**
 * Flujo 429 (R33-06, C-36 a C-42): el diagnóstico del CV con palabra y número entero. Persona B (tester).
 * Con solo un estudio cargado (hay algo, así que la pantalla muestra el diagnóstico) no hay experiencia:
 * legibilidad, largo y logros quedan en pausa con una sola acción principal. Con un trabajo de viñetas
 * vagas el paso es escribir un logro con ayuda. Datos inventados; el historial se borra al empezar y al
 * terminar.
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

async function insert(row: Partial<typeof s.careerHistory.$inferInsert>) {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.careerHistory).values({
      userId: E2E_B_USER_ID,
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista de Pruebas",
      sort: 0,
      ...row,
    });
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

test.describe("Flujo 429: diagnóstico del CV", () => {
  test("sin experiencia: una acción principal y el resto en pausa", async ({ page }) => {
    await insert({ kind: "educacion", organization: "Instituto A", title: "Tecnicatura A" });
    await loginAsSecondUser(page);
    await page.goto("/cv");
    const diag = page.getByTestId("cv-diagnosis");
    await expect(diag).toContainText("No miden si sos buen o buena candidata");
    const principal = page.getByTestId("cv-diag-principal");
    await expect(principal).toContainText("Cargá tu experiencia laboral");
    await expect(principal.getByRole("link", { name: "Agregar mi experiencia" })).toBeVisible();
    for (const id of ["readability", "length", "achievements"]) {
      await expect(page.getByTestId(`cv-diag-${id}`)).toContainText(
        "Se calcula cuando tengas experiencia cargada",
      );
    }
    // Legibilidad y largo son dos barras distintas
    await expect(page.getByTestId("cv-diag-readability")).toContainText("Legibilidad");
    await expect(page.getByTestId("cv-diag-length")).toContainText("Largo");
  });

  test("con viñetas vagas: palabra, número entero y paso concreto", async ({ page }) => {
    await insert({ bullets: ["Coordiné tareas del área administrativa"], sort: 1 });
    await loginAsSecondUser(page);
    await page.goto("/cv");
    await expect(page.getByTestId("cv-diag-principal")).toHaveCount(0);
    const palabras = /Sólido|En camino|Para reforzar|Sin empezar/;
    for (const id of ["structure", "readability", "length", "achievements", "sections"]) {
      const item = page.getByTestId(`cv-diag-${id}`);
      await expect(item).toContainText(palabras);
      await expect(page.getByTestId(`cv-diag-score-${id}`)).toHaveText(/^\d{1,2}\/10$/);
    }
    // Logros: el paso es escribir un logro con ayuda, no «cargar experiencia»
    await expect(page.getByTestId("cv-diag-achievements")).toContainText(
      "Escribir un logro con ayuda",
    );
    // Cada barra explica qué mide, con su ⓘ
    const tip = page.getByTestId("cv-diag-mide-structure");
    await tip.locator("summary").click();
    await expect(tip).toContainText("las secciones y el orden que esperan los sistemas");
  });

  test("360 px: sin desborde horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginAsSecondUser(page);
    await page.goto("/cv");
    await expect(page.getByTestId("cv-diagnosis")).toBeVisible();
    const { scrollWidth, ancho } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      ancho: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(ancho);
  });
});
