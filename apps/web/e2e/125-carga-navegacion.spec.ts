import { expect, test, type Page } from "@playwright/test";

/**
 * Flujo 125 (R11-8): indicador de carga solo en la navegación del cliente, sin `loading.tsx` ni
 * `<Suspense>`. Se retrasa la respuesta RSC (`?_rsc=`) para poder verlo. Comprueba:
 * - la línea de la barra aparece mientras carga y `main` queda con `aria-busy`;
 * - no hay saltos de diseño en el link;
 * - el status HTTP y los 404 siguen siendo los de siempre;
 * - con `prefers-reduced-motion` no hay animación.
 */
const WIDE = { width: 1280, height: 800 };

async function delayRsc(page: Page, ms: number) {
  await page.route(/[?&]_rsc=/, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test.describe("Flujo 125: carga en la navegación del cliente", () => {
  test("mientras carga Postulaciones, el link muestra el indicador y main queda ocupado", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await page.goto("/hoy");
    await expect(page.locator("main#contenido")).toBeAttached();
    await delayRsc(page, 1500);
    const link = page.getByRole("navigation", { name: "Secciones" }).getByRole("link", {
      name: /Postulaciones/,
    });
    const before = await link.boundingBox();
    await link.click();
    const pending = link.getByTestId("nav-pending");
    await expect(pending).toHaveAttribute("data-pending", "true");
    await expect(page.locator("main#contenido")).toHaveAttribute("aria-busy", "true");
    const during = await link.boundingBox();
    expect(during?.width).toBe(before?.width);
    expect(during?.height).toBe(before?.height);
    await expect(page).toHaveURL(/\/applications/);
    await expect(page.locator("main#contenido")).not.toHaveAttribute("aria-busy", "true");
  });

  test("con «reducir movimiento» el indicador no se anima", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/hoy");
    await delayRsc(page, 1500);
    const link = page.getByRole("navigation", { name: "Secciones" }).getByRole("link", {
      name: /Postulaciones/,
    });
    await link.click();
    const pending = link.getByTestId("nav-pending");
    await expect(pending).toHaveAttribute("data-pending", "true");
    const animation = await pending.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });

  test("el status y los 404 no cambian", async ({ page }) => {
    for (const path of ["/jobs/no-es-un-id", "/inbox/00000000-0000-4000-8000-000000000000"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    const ok = await page.goto("/applications");
    expect(ok?.status()).toBe(200);
  });
});
