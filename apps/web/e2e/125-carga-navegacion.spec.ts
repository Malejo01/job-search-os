import { expect, test, type Locator, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 125 (R11-8, vuelve en R12-15): indicador de carga solo en la navegación del cliente, sin
 * `loading.tsx` ni `<Suspense>`. Se retrasa la respuesta RSC (`?_rsc=`) para poder verlo. Comprueba:
 * - el indicador aparece en la pestaña del celular (390 px, el ancho por defecto) y en la píldora de
 *   la computadora mientras carga, y `main` queda con `aria-busy`;
 * - no hay saltos de diseño en el link;
 * - con `prefers-reduced-motion` no hay animación;
 * - el status HTTP y los 404 siguen siendo los de siempre (con sesión: sin sesión, todo redirige al
 *   login, que responde 200).
 */
const WIDE = { width: 1280, height: 800 };

async function delayRsc(page: Page, ms: number) {
  await page.route(/[?&]_rsc=/, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Postulaciones en las pestañas del celular o en la barra de la computadora. */
function applicationsLink(page: Page, where: "tabbar" | "desktop"): Locator {
  const scope =
    where === "tabbar"
      ? page.getByTestId("tabbar")
      : page.getByRole("navigation", { name: "Secciones" });
  return scope.getByRole("link", { name: "Postulaciones", exact: true });
}

async function expectPendingWhileLoading(page: Page, link: Locator) {
  await expect(link).toBeVisible();
  const before = await link.boundingBox();
  await delayRsc(page, 1500);
  await link.click();
  await expect(link.getByTestId("nav-pending")).toHaveAttribute("data-pending", "true");
  await expect(page.locator("main#contenido")).toHaveAttribute("aria-busy", "true");
  const during = await link.boundingBox();
  expect(during?.width).toBe(before?.width);
  expect(during?.height).toBe(before?.height);
  await page.waitForURL(/\/applications(?:[?#]|$)/);
  await expect(page.locator("main#contenido")).not.toHaveAttribute("aria-busy", "true");
}

test.describe("Flujo 125: carga en la navegación del cliente", () => {
  test("en el celular, la pestaña de Postulaciones muestra el indicador y main queda ocupado", async ({
    page,
  }) => {
    await login(page);
    await expect(page.locator("main#contenido")).toBeAttached();
    await expectPendingWhileLoading(page, applicationsLink(page, "tabbar"));
  });

  test("en la computadora, la píldora de Postulaciones muestra el indicador", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await login(page);
    await expectPendingWhileLoading(page, applicationsLink(page, "desktop"));
  });

  test("con «reducir movimiento» el indicador no se anima", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    const link = applicationsLink(page, "tabbar");
    await expect(link).toBeVisible();
    await delayRsc(page, 1500);
    await link.click();
    const pending = link.getByTestId("nav-pending");
    await expect(pending).toHaveAttribute("data-pending", "true");
    const animation = await pending.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
    await page.waitForURL(/\/applications(?:[?#]|$)/);
  });

  test("con sesión, el status y los 404 no cambian", async ({ page }) => {
    await login(page);
    for (const path of ["/jobs/no-es-un-id", "/inbox/00000000-0000-4000-8000-000000000000"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    const ok = await page.goto("/applications");
    expect(ok?.status()).toBe(200);
  });
});
