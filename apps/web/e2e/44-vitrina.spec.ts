import { waitlist } from "@job-search-os/db/schema";
import { BRAND } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { login, ownerDb, openOtherCareer } from "./helpers";

/**
 * Flujo 44 (ronda 63): vitrina pública. Portada, mercado, ofertas de muestra y pedido de acceso sin
 * sesión; con sesión `/` lleva a /hoy (ronda 119b); y a 360 px nada se desborda. Las páginas son ISR y pueden
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
    const submit = page.getByRole("button", { name: "Pedir acceso", exact: true });
    await submit.click();
    await expect(page.getByLabel("Nombre")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");

    const fill = async () => {
      await page.getByLabel("Nombre").fill("Persona Vitrina");
      await page.getByLabel("Email").fill(email.toUpperCase());
      // Fuera de las 8 de la beta, la carrera está en «Otra carrera» (C10-5)
      await openOtherCareer(page);
      await page.getByLabel("Carrera").selectOption("data_analyst");
      await page.getByRole("button", { name: "Pedir acceso", exact: true }).click();
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

  test("/acceso: las 8 carreras de la beta como chips (C1)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/acceso");
    await expect(page.locator("main")).toContainText("8 carreras");
    const chips = page.locator('input[name="carrera-chip"]');
    await expect(chips).toHaveCount(8);
    for (const name of [
      "Abogacía",
      "Contaduría",
      "Administración",
      "Comunicación",
      "Marketing",
      "Relaciones públicas",
      "Relaciones internacionales",
      "Programación",
    ]) {
      await expect(page.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    // Desde C3 (ADR-033) cada chip guarda su propia carrera
    const role = page.locator('input[type="hidden"][name="role"]');
    await page.getByRole("radio", { name: "Relaciones públicas", exact: true }).check();
    await expect(role).toHaveValue("relaciones_publicas");
    await expect(page.getByRole("radio", { name: "Marketing", exact: true })).not.toBeChecked();
    await page.getByRole("radio", { name: "Marketing", exact: true }).check();
    await expect(role).toHaveValue("marketing_digital");
    await page.getByRole("radio", { name: "Programación", exact: true }).check();
    await expect(role).toHaveValue("fullstack");
  });

  test("/acceso: las carreras de la beta van primero en el selector, en su propio grupo (C6-1)", async ({
    page,
  }) => {
    await page.goto("/acceso");
    const groups = await page.getByLabel("Carrera").evaluate((select) =>
      Array.from(select.querySelectorAll("optgroup")).map((g) => ({
        label: g.label,
        values: Array.from(g.querySelectorAll("option")).map((o) => o.value),
      })),
    );
    expect(groups[0]).toEqual({
      label: "Carreras de la beta",
      values: [
        "abogacia",
        "finanzas_contabilidad",
        "administracion_empresas",
        "comunicacion",
        "marketing_digital",
        "relaciones_publicas",
        "relaciones_internacionales",
        "fullstack",
      ],
    });
    // El resto sigue ofreciéndose, sin repetir ninguna de la beta
    const rest = groups.slice(1).flatMap((g) => g.values);
    expect(rest).toContain("data_analyst");
    for (const key of groups[0]?.values ?? []) expect(rest).not.toContain(key);
  });

  test("sin sesión: portada, mercado, una carrera, ofertas y pedir acceso", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /quedan bien, con el porqué/ }),
    ).toBeVisible();
    // C7-11: la voz del manual (M7), en primera persona
    await expect(page.getByText("Nunca postulamos por vos", { exact: true })).toBeVisible();
    await expect(page.getByText("No leemos tu bandeja")).toBeVisible();
    await expect(page.getByText(BRAND.tagline).first()).toBeVisible();
    await expect(page.getByText("Tus datos son tuyos")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cómo funciona" })).toBeVisible();
    await expect(page.getByTestId("pool-numbers")).toBeVisible();
    // C7-2: el header lleva el logo, con el nombre como nombre accesible, y lleva a la portada
    await expect(
      page.locator("header").getByRole("link", { name: BRAND.name, exact: true }),
    ).toHaveAttribute("href", "/");

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

    // El botón de la barra se ve desde `sm` (C10-3): en el celular está en la página
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link", { name: "Pedir acceso" })
      .click();
    await expect(page).toHaveURL(/\/acceso$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Pedir acceso a la beta/ }),
    ).toBeVisible();
  });

  test("sin CONTACT_EMAIL no aparece ninguna línea de contacto", async ({ page }) => {
    // El CI no define la variable; con ella cargada (ISR) el caso con email lo cubren los unit tests
    test.skip(!!process.env.CONTACT_EMAIL, "CONTACT_EMAIL definido en este entorno");
    for (const path of ["/acceso", "/ofertas"]) {
      await page.goto(path);
      await expect(page.getByText(/escribinos/i), path).toHaveCount(0);
    }
  });

  test("una carrera que no existe da 404 y /ofertas no se indexa", async ({ page, request }) => {
    const missing = await request.get("/mercado/no-existe");
    expect(missing.status()).toBe(404);
    const response = await page.goto("/ofertas");
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("una carrera trae datos estructurados de Dataset, nunca de JobPosting (C-18)", async ({
    page,
  }) => {
    await page.goto("/mercado/data_analyst");
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(raw ?? "{}") as Record<string, unknown>;
    expect(data["@type"]).toBe("Dataset");
    expect(raw).not.toContain("JobPosting");
    // El Dataset describe el mercado, no la marca
    expect(raw).not.toContain(BRAND.name);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Mercado/);
  });

  test("los títulos públicos llevan el nombre del producto (C7-2)", async ({ page }) => {
    for (const path of ["/", "/mercado", "/ofertas", "/acceso"]) {
      await page.goto(path);
      expect(await page.title(), path).toContain(BRAND.name);
    }
    await page.goto("/");
    expect(await page.title()).toBe(`${BRAND.name} · ${BRAND.tagline}`);
  });

  test("el favicon, el ícono de iPhone y el manifest se sirven sin sesión (C7-2)", async ({
    request,
  }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    const data = (await manifest.json()) as {
      name: string;
      short_name: string;
      icons: { src: string }[];
    };
    expect(data.name).toBe(BRAND.name);
    expect(data.short_name).toBe(BRAND.name);
    for (const icon of data.icons) {
      const res = await request.get(icon.src, { maxRedirects: 0 });
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"], icon.src).toContain("image/png");
    }
    for (const path of ["/icon.svg", "/apple-icon.png"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
    }
  });

  test("las imágenes para compartir se sirven sin sesión (C7-2)", async ({ page, request }) => {
    await page.goto("/");
    // La ruta lleva un sufijo que pone Next (grupo de rutas): se lee de los metadatos
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const content = await page.locator(selector).first().getAttribute("content");
      expect(content, selector).not.toBeNull();
      const res = await request.get(new URL(content!).pathname, { maxRedirects: 0 });
      expect(res.status(), selector).toBe(200);
      expect(res.headers()["content-type"], selector).toContain("image/png");
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

  test("con sesión, la portada, /acceso y /login redirigen a /hoy", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/hoy$/);
    await page.goto("/acceso");
    await expect(page).toHaveURL(/\/hoy$/);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/hoy$/);
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
