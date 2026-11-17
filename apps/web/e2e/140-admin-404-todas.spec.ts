import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 140 (R11-6): cada pantalla y cada ruta de descarga de administración responde 404 a una
 * cuenta común. La lista espeja `ADMIN_ONLY_FILES` de `apps/web/lib/admin-routes.ts` (un test
 * unitario obliga a que esa lista cubra todo el árbol). Las Server Actions de admin las cubre el test
 * unitario del árbol: ninguna es alcanzable sin la pantalla, y cada una comprueba el rol en el servidor.
 */
const PAGES = [
  "/ui",
  "/settings/invitations",
  "/settings/planes",
  "/settings/marca",
  "/settings/marca/componentes",
  "/settings/textos",
  "/settings/metricas",
  "/settings/salud",
  "/settings/feedback",
];

const ROUTES = [
  "/settings/invitations/export",
  "/settings/feedback/export",
  "/settings/marca/email-bienvenida",
];

test.describe("Flujo 140: administración con cuenta común", () => {
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await ensureSecondUser();
    await loginAsSecondUser(page);
  });

  for (const path of PAGES) {
    test(`${path} responde 404`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(404);
    });
  }

  for (const path of ROUTES) {
    test(`${path} responde 404 sin entregar datos`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
      const body = await res.text();
      expect(body).not.toContain("@");
      expect(res.headers()["content-type"] ?? "").not.toContain("text/csv");
    });
  }
});
