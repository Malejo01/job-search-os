import { expect, test, type Page } from "@playwright/test";

/**
 * Flujo 55 (ronda 85): las listas de links a páginas ISR de la vitrina (chips de carreras en
 * /mercado y /ofertas, carreras con más remotas, perfiles de la demo) no se prefetchean. Antes, cada
 * visita a /mercado generaba en el servidor las 13 páginas de carrera, y después de un deploy con el
 * pool vacío las dejaba vacías en el caché por 30 minutos (diagnóstico de la ronda 80).
 *
 * El prefetch existe solo con `next start` (el CI). Con `next dev` no hay prefetch y el chequeo de
 * pedidos pasa siempre; la navegación al tocar el chip se verifica igual en los dos.
 */
const ISR_LIST = /^\/(mercado|ofertas|demo)\/[^/]+$/;

/** Junta las rutas de los pedidos de prefetch del router hacia páginas de carrera o de perfil. */
function trackPrefetch(page: Page) {
  const seen: string[] = [];
  page.on("request", (req) => {
    const headers = req.headers();
    if (!headers["next-router-prefetch"]) return;
    const path = new URL(req.url()).pathname;
    if (ISR_LIST.test(path)) seen.push(path);
  });
  return seen;
}

/** El router prefetchea los links visibles cuando la página queda ociosa: se le da ese margen. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
}

test.describe("Flujo 55: sin prefetch de páginas de carrera", () => {
  for (const path of ["/mercado", "/ofertas", "/demo"]) {
    test(`${path}: ninguna página de carrera o perfil se pide antes de tocarla`, async ({
      page,
    }) => {
      const seen = trackPrefetch(page);
      await page.goto(path);
      await settle(page);
      expect(seen, `prefetch de ${seen.join(", ")}`).toEqual([]);
    });
  }

  test("tocar un chip igual lleva a la carrera", async ({ page }) => {
    await page.goto("/mercado");
    const chips = page.getByRole("navigation", { name: "Carreras" });
    const first = chips.getByRole("link").first();
    const href = await first.getAttribute("href");
    expect(href).toMatch(/^\/mercado\/[a-z_]+$/);
    await first.click();
    await page.waitForURL(`**${href}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
