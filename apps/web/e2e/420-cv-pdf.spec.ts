import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 420 (R33-08, C-48 a C-55): descarga del CV en PDF. La ruta `/api/cv/pdf` exige sesión (401 o
 * redirección al login), responde `attachment` con `no-store` y sin URL pública, y el archivo es un PDF
 * real: texto seleccionable (operadores `Tj`), acentos y eñes en WinAnsi y links como anotaciones. El
 * ritmo frena las descargas seguidas (429 con `Retry-After`). Datos inventados y únicos por corrida; solo
 * se borra lo que crea este archivo.
 */
const EMPRESA = `Empresa Ficticia PDF ${Date.now()}`;
const PROYECTO = `Proyecto Ficticio PDF ${Date.now()}`;
const LINK = "https://ejemplo.test/persona-ficticia/proyecto-pdf";
const VINETA = "Diseñé la planificación de turnos con acentos y eñes";

test.describe.configure({ mode: "serial" });

async function cleanOwn() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.careerHistory).where(eq(s.careerHistory.organization, EMPRESA));
    await db.delete(s.careerHistory).where(eq(s.careerHistory.organization, PROYECTO));
  } finally {
    await close();
  }
}

test.beforeAll(async () => {
  await cleanOwn();
  const { db, close } = ownerDb();
  try {
    await db.insert(s.careerHistory).values([
      {
        userId: E2E_USER_ID,
        kind: "trabajo",
        organization: EMPRESA,
        title: "Analista de Pruebas",
        startMonth: "2022-03",
        endMonth: "2024-01",
        bullets: [VINETA],
        source: "manual",
        sort: 900,
      },
      {
        userId: E2E_USER_ID,
        kind: "proyecto",
        organization: PROYECTO,
        title: "Desarrolladora",
        startMonth: "2023-01",
        endMonth: "2023-06",
        bullets: ["Armé el tablero de turnos"],
        link: LINK,
        source: "manual",
        sort: 901,
      },
    ]);
  } finally {
    await close();
  }
});
test.afterAll(cleanOwn);

/** GET con una espera si el ritmo de una corrida anterior todavía no se liberó. */
async function getPdf(page: Page, query: string): Promise<APIResponse> {
  let res = await page.request.get(`/api/cv/pdf?${query}`);
  if (res.status() === 429) {
    await page.waitForTimeout((Number(res.headers()["retry-after"] ?? "60") + 1) * 1000);
    res = await page.request.get(`/api/cv/pdf?${query}`);
  }
  return res;
}

test.describe("Flujo 420: CV en PDF", () => {
  test("el PDF es real: tipo, adjunto, no-store, texto con acentos y link tocable", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await login(page);
    const res = await getPdf(page, "lang=es&email=1");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="CV[^"]*\.pdf"$/);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    const body = await res.body();
    const text = body.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // Con `next dev` o detrás de compresión el header puede no venir: si viene, tiene que coincidir
    const largo = res.headers()["content-length"];
    if (largo !== undefined) expect(Number(largo)).toBe(body.length);
    // Texto seleccionable: operadores Tj, no una imagen
    expect(text).toContain(" Tj");
    expect(text).not.toContain("/Subtype /Image");
    expect(text).toContain(EMPRESA);
    expect(text).toContain("Analista de Pruebas");
    // «ñ» y «é» van como bytes WinAnsi (0xF1 y 0xE9), no en UTF-8
    expect(text).toContain("Diseñé la planificación de turnos");
    // El link del proyecto es una anotación con acción URI, y también está como texto
    expect(text).toContain(`/URI (${LINK})`);
    expect(text).toContain(LINK);
    // A4
    expect(text).toContain("/MediaBox [0 0 595.28 841.89]");
  });

  test("en inglés cambian los títulos; sin email no sale el email", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page);
    const res = await getPdf(page, "lang=en&email=0");
    expect(res.status()).toBe(200);
    const text = (await res.body()).toString("latin1");
    expect(text).toContain("(Experience) Tj");
    expect(text).toContain("(Projects) Tj");
    expect(text).not.toContain("mailto:");
  });

  test("sin sesión no hay archivo", async ({ request }) => {
    const anon = await request.get("/api/cv/pdf", { maxRedirects: 0 });
    expect([307, 401]).toContain(anon.status());
    expect(anon.headers()["content-type"] ?? "").not.toContain("application/pdf");
  });

  test("«Descargar PDF» baja CV-Nombre-Apellido.pdf y avisa mientras genera", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page);
    await page.goto("/cv");
    const boton = page.getByTestId("cv-descargar-pdf");
    await expect(boton).toBeVisible();
    await expect(boton).toHaveText("Descargar PDF");
    const descarga = page.waitForEvent("download");
    await boton.click();
    // Si el CV está incompleto, antes pregunta si completarlo (R33-07): se baja igual
    const igual = page.getByTestId("cv-descargar-igual");
    await igual
      .waitFor({ state: "visible", timeout: 2000 })
      .then(() => igual.click())
      .catch(() => undefined);
    const file = await descarga;
    expect(file.suggestedFilename()).toMatch(/^CV(-[A-Za-z0-9]+)*\.pdf$/);
    await expect(page.getByTestId("cv-descargar-pdf-estado")).toContainText(
      /Listo|Generando|Descargaste muchas veces/,
    );
  });

  test("el ritmo frena las descargas seguidas con Retry-After", async ({ page }) => {
    test.setTimeout(150_000);
    await login(page);
    const statuses: number[] = [];
    let retry = "";
    for (let i = 0; i < 10; i++) {
      const res = await page.request.get("/api/cv/pdf?lang=es");
      statuses.push(res.status());
      if (res.status() === 429) {
        retry = res.headers()["retry-after"] ?? "";
        break;
      }
    }
    expect(statuses).toContain(429);
    expect(Number(retry)).toBeGreaterThan(0);
    expect(Number(retry)).toBeLessThanOrEqual(3600);
  });
});
