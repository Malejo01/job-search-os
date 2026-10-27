import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 85 (C-25, CVC-2): «Tu CV». Cargar un trabajo a mano en /settings/historial, verlo en la vista
 * previa de /cv (HTML semántico), descargar el DOCX (tipo, attachment, no-store y el texto adentro),
 * 401 sin sesión, hoja de impresión sin nav, axe y 360 px. Datos inventados y únicos por corrida; se
 * borran al final.
 */
const EMPRESA = `Empresa Ficticia CV ${Date.now()}`;
const CARGO = "Analista de Pruebas";
const VINETA = "Automaticé la revisión de reportes semanales";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test.use({ viewport: { width: 360, height: 800 } });
test.describe.configure({ mode: "serial" });

async function cleanHistory() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_USER_ID));
  } finally {
    await close();
  }
}

test.beforeAll(cleanHistory);
test.afterAll(cleanHistory);

async function expectNoOverflowNorAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  const { scrollWidth, ancho } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    ancho: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(ancho);
}

test.describe("Flujo 85: Tu CV", () => {
  test("sin historial, /cv avisa qué falta y lleva a cargarlo", async ({ page }) => {
    await login(page);
    await page.goto("/cv");
    await expect(page.getByRole("heading", { name: "Tu CV", level: 1 })).toBeVisible();
    const faltan = page.getByTestId("cv-faltantes");
    await expect(faltan).toContainText("tu experiencia laboral");
    await faltan.getByRole("link", { name: "Cargá tu historial" }).first().click();
    await page.waitForURL("**/settings/historial");
  });

  test("valida sin devolver lo escrito y carga un trabajo a mano", async ({ page }) => {
    await login(page);
    await page.goto("/settings/historial");
    await expectNoOverflowNorAxe(page);

    // Fin sin inicio: error por campo, sin eco del valor
    await page.getByLabel("Empresa o institución").fill(EMPRESA);
    await page.getByLabel("Cargo o título").fill(CARGO);
    await page.getByLabel("Fin (vacío si sigue)").fill("2024-01");
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "El fin no puede ser anterior",
    );
    await expect(page.locator("main").getByRole("alert")).not.toContainText(EMPRESA);

    await page.getByLabel("Empresa o institución").fill(EMPRESA);
    await page.getByLabel("Cargo o título").fill(CARGO);
    await page.getByLabel("Inicio").fill("2022-03");
    await page.getByLabel("Fin (vacío si sigue)").fill("2024-01");
    await page.getByLabel("Qué hiciste y qué lograste").fill(`${VINETA}\nSegunda viñeta ficticia`);
    await page.getByRole("button", { name: "Agregar" }).click();
    await expect(page.getByRole("status")).toContainText("Guardado.");
    await expect(page.getByTestId("history-entry")).toContainText(CARGO);

    // Un link en una viñeta no se acepta
    const nueva = page.getByRole("region", { name: "Sumar una entrada" });
    await nueva.getByLabel("Empresa o institución").fill("Empresa B");
    await nueva.getByLabel("Cargo o título").fill("Cargo B");
    await nueva.getByLabel("Qué hiciste y qué lograste").fill("Mirá https://ejemplo.test/x");
    await nueva.getByRole("button", { name: "Agregar" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("sin links");
    await expect(page.getByTestId("history-entry")).toHaveCount(1);
  });

  test("la vista previa muestra el trabajo con encabezados reales, sin desborde ni axe", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/cv");
    const preview = page.getByTestId("cv-preview");
    await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Experiencia", level: 2 })).toBeVisible();
    await expect(preview.getByRole("heading", { name: CARGO, level: 3 })).toBeVisible();
    await expect(preview).toContainText(EMPRESA);
    await expect(preview).toContainText("03/2022 – 01/2024");
    await expect(preview.getByRole("listitem").filter({ hasText: VINETA })).toBeVisible();
    await expectNoOverflowNorAxe(page);
  });

  test("al imprimir quedan solo la hoja: sin nav, encabezado ni pie", async ({ page }) => {
    await login(page);
    await page.goto("/cv");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("cv-preview")).toBeVisible();
    await expect(page.locator("header")).toBeHidden();
    await expect(page.locator("footer")).toBeHidden();
    await expect(page.getByRole("link", { name: "Descargar DOCX" })).toBeHidden();
  });

  test("descarga el DOCX con el texto adentro; sin sesión da 401", async ({ page, request }) => {
    await login(page);
    await page.goto("/cv");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Descargar DOCX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^CV(-[A-Za-z0-9]+)*\.docx$/);

    const res = await page.request.get("/api/cv/docx?lang=es&email=1");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe(DOCX_TYPE);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="CV[^"]*\.docx"$/);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.body();
    // ZIP (PK) con las entradas sin comprimir: el texto se lee directo
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
    const text = body.toString("utf8");
    expect(text).toContain("word/document.xml");
    expect(text).toContain(EMPRESA);
    expect(text).toContain(CARGO);
    expect(text).toContain(VINETA);

    // En inglés cambian los títulos; sin sesión no hay descarga
    const en = await page.request.get("/api/cv/docx?lang=en");
    expect(en.status()).toBe(200);
    expect((await en.body()).toString("utf8")).toContain("Experience");
    // El middleware manda a /login (307); si no, la ruta misma contesta 401. Nunca el archivo.
    const anon = await request.get("/api/cv/docx", { maxRedirects: 0 });
    expect([307, 401]).toContain(anon.status());
    expect(anon.headers()["content-type"] ?? "").not.toContain("wordprocessingml");
  });

  test("edita y borra la entrada", async ({ page }) => {
    await login(page);
    await page.goto("/settings/historial");
    const entry = page.getByTestId("history-entry").first();
    await entry.getByText("Editar").click();
    await entry.getByLabel("Cargo o título").fill("Analista Senior de Pruebas");
    await entry.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByTestId("history-entry").first()).toContainText(
      "Analista Senior de Pruebas",
    );
    await page.getByRole("button", { name: /^Borrar / }).click();
    await expect(page.getByRole("status")).toContainText("Entrada borrada.");
    await expect(page.getByTestId("history-entry")).toHaveCount(0);
  });
});
