import { waitlist } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { login, ownerDb } from "./helpers";

/**
 * Flujo 44 (ronda 63): vitrina pública. Portada, mercado, ofertas de muestra y pedido de acceso sin
 * sesión; con sesión `/` lleva a /jobs; y a 360 px nada se desborda. Las páginas son ISR y pueden
 * haberse prerenderizado antes de cargar datos: se verifica la estructura (headings y secciones),
 * nunca cantidades. La lista de espera usa un email inventado con Date.now() y lo borra al final.
 */
test.describe("Flujo 44: vitrina pública", () => {
  const email = `persona.vitrina.${Date.now()}@example.com`;

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(waitlist).where(eq(waitlist.email, email));
    } finally {
      await close();
    }
  });

  test("pedir acceso: errores por campo, alta y el mismo mensaje si se repite", async ({
    page,
  }) => {
    await page.goto("/acceso");
    const submit = page.getByRole("button", { name: "Pedir acceso" });
    await submit.click();
    await expect(page.getByLabel("Nombre")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");

    const fill = async () => {
      await page.getByLabel("Nombre").fill("Persona Vitrina");
      await page.getByLabel("Email").fill(email.toUpperCase());
      await page.getByLabel("Carrera").selectOption("data_analyst");
      await page.getByRole("button", { name: "Pedir acceso" }).click();
    };
    await fill();
    const done = page.getByRole("status").filter({ hasText: "te anotamos" });
    await expect(done).toBeVisible();

    // El email quedó normalizado y una sola vez
    const { db, close } = ownerDb();
    try {
      const rows = await db
        .select({ id: waitlist.id })
        .from(waitlist)
        .where(eq(waitlist.email, email));
      expect(rows).toHaveLength(1);
    } finally {
      await close();
    }

    // Repetido: mismo mensaje (no revela si el email ya estaba)
    await page.goto("/acceso");
    await fill();
    await expect(done).toBeVisible();
  });

  test("sin sesión: portada, mercado, una carrera, ofertas y pedir acceso", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /por qué sí y por qué no/ }),
    ).toBeVisible();
    await expect(page.getByText("Nunca postula por vos")).toBeVisible();
    await expect(page.getByText("No lee tu bandeja")).toBeVisible();
    await expect(page.getByText("Tus datos son tuyos")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cómo funciona" })).toBeVisible();
    await expect(page.getByTestId("pool-numbers")).toBeVisible();
    // El header no lleva el nombre del producto
    await expect(page.locator("header")).not.toContainText("Job Search OS");

    // A 390 px (viewport de los e2e) Mercado y Ofertas están en el pie, no en el header: se busca
    // en toda la página el primero visible (getByRole ignora los ocultos con display: none).
    const visibleLink = (name: string) => page.getByRole("link", { name, exact: true }).first();
    await visibleLink("Mercado").click();
    await expect(page).toHaveURL(/\/mercado$/);
    await expect(page.getByRole("heading", { level: 1, name: "Mercado" })).toBeVisible();

    await page.getByRole("navigation", { name: "Carreras" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/mercado\/[a-z_]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Qué piden las ofertas de");
    await expect(page.getByTestId("career-market")).toBeVisible();

    await visibleLink("Ofertas").click();
    await expect(page).toHaveURL(/\/ofertas$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ofertas de muestra" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Más recientes" })).toBeVisible();

    await page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link", { name: "Pedir acceso" })
      .click();
    await expect(page).toHaveURL(/\/acceso$/);
    await expect(page.getByRole("heading", { name: "Pedir acceso" })).toBeVisible();
  });

  test("una carrera que no existe da 404 y /ofertas no se indexa", async ({ page, request }) => {
    const missing = await request.get("/mercado/no-existe");
    expect(missing.status()).toBe(404);
    const response = await page.goto("/ofertas");
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("los títulos públicos no llevan el nombre del producto", async ({ page }) => {
    for (const path of ["/", "/mercado", "/ofertas", "/acceso"]) {
      await page.goto(path);
      expect(await page.title(), path).not.toContain("Job Search OS");
    }
  });

  test("robots.txt y sitemap.xml son públicos", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    expect(text).toContain("Disallow: /jobs");
    expect(text).not.toMatch(/Disallow: \/ofertas/);
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("/mercado");
  });

  test("con sesión, la portada y /acceso redirigen a /jobs", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/jobs/);
    await page.goto("/acceso");
    await expect(page).toHaveURL(/\/jobs/);
  });

  test("una página pública que no existe muestra el 404 con el layout público", async ({
    page,
  }) => {
    await page.goto("/mercado/no-existe");
    await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver ofertas de muestra" })).toBeVisible();
  });

  test.describe("360 px", () => {
    test.use({ viewport: { width: 360, height: 740 } });
    for (const path of ["/", "/mercado", "/ofertas"]) {
      test(`${path} no tiene scroll horizontal`, async ({ page }) => {
        await page.goto(path);
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width).toBeLessThanOrEqual(360);
      });
    }
  });
});
