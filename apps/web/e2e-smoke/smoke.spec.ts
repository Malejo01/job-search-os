import { expect, test } from "@playwright/test";

// Solo lectura: no hay clics en botones que escriban ni formularios fuera del login.
const EMAIL = process.env.E2E_PROD_EMAIL;
const PASSWORD = process.env.E2E_PROD_PASSWORD;

test("health responde ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok?: boolean; commit?: string };
  expect(body.ok).toBe(true);
  if (body.commit) console.log(`commit desplegado: ${body.commit}`);
});

test.describe("con sesión", () => {
  test.skip(!EMAIL || !PASSWORD, "faltan E2E_PROD_EMAIL/E2E_PROD_PASSWORD (los crea Mauro)");

  test("login, /hoy, /jobs, primera oferta y /applications", async ({ page }) => {
    // Mismos locators que e2e/helpers.ts (login), sin importar nada que toque la base
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL ?? "");
    await page.getByLabel("Contraseña").fill(PASSWORD ?? "");
    await page.getByRole("button", { name: "Entrar" }).click();
    // El login aterriza en /hoy (ronda 119); /jobs se visita aparte, como antes
    await page.waitForURL("**/hoy**");
    await expect(page.getByRole("heading", { level: 1, name: "Hoy" })).toBeVisible();
    await expect(page.getByText(/application error|internal server error/i)).toHaveCount(0);

    await page.goto("/jobs");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/application error|internal server error/i)).toHaveCount(0);

    const firstJob = page.locator('a[href^="/jobs/"]').first();
    if ((await firstJob.count()) > 0) {
      await firstJob.click();
      await page.waitForURL(/\/jobs\/[^/?#]+/);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    } else {
      test.info().annotations.push({ type: "nota", description: "sin ofertas en la lista" });
    }

    await page.goto("/applications");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByText(/application error|internal server error/i)).toHaveCount(0);
  });
});
