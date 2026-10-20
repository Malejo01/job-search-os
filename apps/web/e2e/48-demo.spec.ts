import { demoEvaluations, publicJobs } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { ownerDb } from "./helpers";

/**
 * Flujo 48 (ronda 74): demo guiada pública. Sin sesión, `/demo` lista los 3 perfiles; cada perfil
 * muestra tarjetas o "Estamos preparando la demo". Las páginas son ISR y la tabla puede estar vacía
 * en el CI: el perfil `fullstack_ssr` se siembra con una evaluación ficticia ANTES de la primera
 * visita (generateStaticParams es vacío, así que no se prerenderiza en el build) y se borra al final.
 */
test.describe("Flujo 48: demo guiada", () => {
  const tag = Date.now();
  const externalId = `e2e-pool-demo-${tag}`;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const now = new Date();
      const [job] = await db
        .insert(publicJobs)
        .values({
          sourceKind: "remoteok",
          externalId,
          sourceName: "Remote OK",
          sourceUrl: "https://example.com/aviso-demo",
          canonicalUrl: "https://example.com/aviso-demo",
          title: `Desarrollo full stack ficticio ${tag}`,
          titleNormalized: `desarrollo full stack ficticio ${tag}`,
          companyRaw: "Empresa Ficticia Demo",
          companyNormalized: "empresa ficticia demo",
          locationRaw: "Remoto (Anywhere in the World)",
          modality: "remoto",
          jdText: "Descripción ficticia que la demo nunca muestra.",
          jdHash: externalId,
          roleHints: ["fullstack"],
          postedAt: now,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .returning({ id: publicJobs.id });
      await db.insert(demoEvaluations).values({
        profileKey: "fullstack_ssr",
        publicJobId: job!.id,
        promptVersion: "e2e",
        model: "fake",
        score: 7.5,
        scoreModel: 7.5,
        accion: "aplicar",
        matchFuerte: ["Coincide con React y Node"],
        gaps: ["Pide más años en la nube"],
        bloqueadores: [],
        riesgos: [],
        veredicto: "Evaluación ficticia de prueba.",
        locationOk: "ok",
        evaluatedAt: now,
      });
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      // La evaluación se borra en cascada con el aviso
      await db.delete(publicJobs).where(eq(publicJobs.externalId, externalId));
    } finally {
      await close();
    }
  });

  test("sin sesión, /demo muestra los 3 perfiles y se entra a uno", async ({ page }) => {
    await page.goto("/demo");
    await expect(
      page.getByRole("heading", { level: 1, name: /así evalúa ofertas reales/i }),
    ).toBeVisible();
    await expect(page.getByTestId("demo-profile-card")).toHaveCount(3);
    expect(await page.title()).not.toContain("Job Search OS");

    // /demo es ISR: si se cacheó vacía no hay links ("Pronto"), pero el perfil se abre igual
    const link = page.getByRole("link", { name: "Ver la demo de Full stack semi senior" });
    if (await link.count()) await link.click();
    else await page.goto("/demo/fullstack_ssr");
    await expect(page).toHaveURL(/\/demo\/fullstack_ssr$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Full stack semi senior" }),
    ).toBeVisible();
    await expect(page.getByTestId("demo-profile")).toContainText("Perfil inventado");
    // Tarjetas o estado vacío, nunca una página rota
    await expect(
      page.getByTestId("demo-card").or(page.getByTestId("demo-preparando")).first(),
    ).toBeVisible();
  });

  test("un perfil que no existe da 404", async ({ request }) => {
    expect((await request.get("/demo/no-existe")).status()).toBe(404);
  });

  test("la tarjeta muestra puntaje, por qué sí, por qué no, acción y link, sin la JD", async ({
    page,
  }) => {
    await page.goto("/demo/fullstack_ssr");
    const card = page.getByTestId("demo-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("7,5");
    await expect(card).toContainText("Por qué sí");
    await expect(card).toContainText("Por qué no");
    await expect(card).toContainText("Aplicar");
    await expect(card.getByRole("link", { name: /Ver el aviso original/ })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("nunca muestra");
  });

  test("👍 muestra el texto de prueba", async ({ page }) => {
    await page.goto("/demo/fullstack_ssr");
    const card = page.getByTestId("demo-card").first();
    await card.getByRole("button", { name: "Me sirvió" }).click();
    await expect(card.getByRole("status")).toContainText("Acá no se guarda nada");
  });

  test("el recorrido se abre con el botón, avanza y se cierra", async ({ page }) => {
    await page.goto("/demo/fullstack_ssr");
    const tour = page.getByTestId("demo-tour");
    // No se autoabre
    await expect(tour).toBeHidden();
    await page.getByRole("button", { name: "Ver recorrido" }).click();
    await expect(tour).toBeVisible();
    await expect(tour).toContainText("Paso 1 de 5");
    await tour.getByRole("button", { name: "Siguiente" }).click();
    await expect(tour).toContainText("El puntaje");
    await tour.getByRole("button", { name: "Siguiente" }).click();
    await tour.getByRole("button", { name: "Siguiente" }).click();
    await tour.getByRole("button", { name: "Siguiente" }).click();
    await expect(tour).toContainText("Paso 5 de 5");
    await expect(tour.getByRole("link", { name: "Pedir acceso" })).toBeVisible();
    await tour.getByRole("button", { name: "Anterior" }).click();
    await expect(tour).toContainText("Paso 4 de 5");
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
    // Al cerrar, el foco vuelve al botón
    await expect(page.getByRole("button", { name: "Ver recorrido" })).toBeFocused();

    // Se puede reabrir y saltar
    await page.getByRole("button", { name: "Ver recorrido" }).click();
    await expect(page.getByTestId("demo-tour")).toContainText("Paso 1 de 5");
    await page.getByTestId("demo-tour").getByRole("button", { name: "Saltar" }).click();
    await expect(page.getByTestId("demo-tour")).toBeHidden();
  });

  test.describe("360 px", () => {
    test.use({ viewport: { width: 360, height: 740 } });
    for (const path of ["/demo", "/demo/fullstack_ssr", "/demo/ai_engineer"]) {
      test(`${path} no tiene scroll horizontal`, async ({ page }) => {
        await page.goto(path);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width).toBeLessThanOrEqual(360);
      });
    }
  });
});
