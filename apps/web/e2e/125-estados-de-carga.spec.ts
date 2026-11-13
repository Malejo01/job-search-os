import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 125 (R5-C6, rehecho en R8-0): estados de carga. Con la red lenta (las navegaciones del
 * cliente tardan 1,5 s) aparece el esqueleto de la pantalla y, cuando llegan los datos, el contenedor
 * no se mueve.
 *
 * Además fija lo que rompió la primera versión: un `loading.tsx` pone el streaming y el status 200
 * antes de que la página llame a `notFound()`. Los detalles (`/jobs/[id]`, `/inbox/[id]`) no pueden
 * tener esqueleto de ruta y tienen que seguir dando 404.
 *
 * La demora se pone solo en los pedidos RSC que no son de precarga: así la navegación espera y el
 * `loading.tsx` ya está en el cliente. Corre en el CI del PR.
 */

const DELAY_MS = 1500;
const UUID_AJENO = "00000000-0000-4000-8000-000000000000";

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

  test("Ofertas: el contenedor es de ancho completo y no salta al cargar", async ({ page }) => {
    // Ofertas usa `<Suspense>` dentro de la página (no un `loading.tsx` de ruta, ver `jobs/page.tsx`):
    // el esqueleto sale en el primer chunk de la respuesta, es decir, después de la demora que este
    // test le pone al pedido. Por eso no se exige verlo con la red lenta: se exige que el `main`
    // (que Hoy ya tiene a ancho completo) quede igual de ancho antes y después de que lleguen los datos.
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await page.goto("/hoy");
    await page.waitForLoadState("networkidle");
    const main = page.locator("main#contenido");
    const mainBefore = await main.boundingBox();
    expect(mainBefore).not.toBeNull();
    await slowNavigations(page);

    await page.locator('nav a[href="/jobs"]').first().click();

    await expect(page.getByRole("heading", { level: 1, name: "Tus ofertas" })).toBeVisible({
      timeout: DELAY_MS + 10_000,
    });
    await expect(page.getByTestId("cargando")).toHaveCount(0);
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

  test("los detalles siguen dando 404 de verdad (sin esqueleto de ruta)", async ({ page }) => {
    await login(page);
    for (const ruta of [`/jobs/${UUID_AJENO}`, `/inbox/${UUID_AJENO}`, "/jobs/no-es-un-id"]) {
      const response = await page.goto(ruta);
      expect(response?.status(), ruta).toBe(404);
    }
  });
});
