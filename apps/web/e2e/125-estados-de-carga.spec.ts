import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 125 (R5-C6): estados de carga. Con la red lenta (las navegaciones del cliente tardan 1,5 s)
 * aparece el esqueleto de la pantalla y, cuando llegan los datos, el contenedor no se mueve.
 *
 * La demora se pone solo en los pedidos RSC que no son de precarga: así la navegación espera y el
 * `loading.tsx` ya está en el cliente. Corre en el CI del PR.
 */

const DELAY_MS = 1500;

async function slowNavigations(page: Page): Promise<void> {
  await page.route(/[?&]_rsc=/, async (route) => {
    const headers = route.request().headers();
    if (headers["next-router-prefetch"] === undefined) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    await route.continue();
  });
}

test.describe("Flujo 125: estados de carga", () => {
  test("Postulaciones: esqueleto con la red lenta y sin saltos al cargar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/hoy");
    await page.waitForLoadState("networkidle");
    await slowNavigations(page);

    await page.locator('nav a[href="/applications"]').first().click();

    const skeleton = page.getByTestId("cargando");
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(skeleton.getByText("Cargando…")).toBeAttached();
    const main = page.locator("main#contenido");
    const mainBefore = await main.boundingBox();
    const skeletonBefore = await skeleton.boundingBox();
    expect(mainBefore).not.toBeNull();
    expect(skeletonBefore).not.toBeNull();

    // Llegan los datos: el esqueleto se va y el contenedor queda en el mismo lugar
    const heading = page.getByRole("heading", { level: 1, name: "Postulaciones" });
    await expect(heading).toBeVisible({ timeout: DELAY_MS + 10_000 });
    await expect(skeleton).toHaveCount(0);
    const mainAfter = await main.boundingBox();
    const headingBox = await heading.boundingBox();
    expect(mainAfter?.x).toBeCloseTo(mainBefore!.x, 0);
    expect(mainAfter?.width).toBeCloseTo(mainBefore!.width, 0);
    // El título real arranca donde arrancaba el esqueleto (±2 px)
    expect(Math.abs(headingBox!.y - skeletonBefore!.y)).toBeLessThanOrEqual(2);
  });

  test("Ofertas: el esqueleto es de ancho completo, como la página", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/hoy");
    await page.waitForLoadState("networkidle");
    await slowNavigations(page);

    await page.locator('nav a[href="/jobs"]').first().click();

    const skeleton = page.getByTestId("cargando");
    await expect(skeleton).toBeVisible();
    const main = page.locator("main#contenido");
    const mainBefore = await main.boundingBox();
    expect(mainBefore).not.toBeNull();

    await expect(page.getByRole("heading", { level: 1, name: "Tus ofertas" })).toBeVisible({
      timeout: DELAY_MS + 10_000,
    });
    await expect(skeleton).toHaveCount(0);
    const mainAfter = await main.boundingBox();
    expect(mainAfter?.x).toBeCloseTo(mainBefore!.x, 0);
    expect(mainAfter?.width).toBeCloseTo(mainBefore!.width, 0);
  });

  test("con «reducir movimiento» el esqueleto no se anima", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/hoy");
    await page.waitForLoadState("networkidle");
    await slowNavigations(page);

    await page.locator('nav a[href="/applications"]').first().click();

    const block = page.getByTestId("cargando").locator("[data-skeleton]").first();
    await expect(block).toBeAttached();
    const animationName = await block.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe("none");
  });
});
