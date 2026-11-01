import { expect, test } from "@playwright/test";

/**
 * Flujo 101 (C6-4, ADR-029): qué carreras se muestran en público. Las de la beta aparecen solas al llegar a
 * 10 ofertas y `asistencia_operaciones` está forzada a oculta. El conteo se cachea una hora y las páginas son
 * ISR, así que acá solo se comprueba lo que no depende de cuántas ofertas haya en la base del CI: una
 * carrera forzada a oculta no se anuncia (chips, sitemap) pero responde sin indexarse, y una que no está
 * sujeta al umbral se muestra siempre. La regla del umbral (9 no, 10 sí, falla cerrado) está en los tests del
 * pipeline (`career-visibility.test.ts`).
 */
const HIDDEN = "asistencia_operaciones";
const HIDDEN_LABEL = "Asistencia virtual y operaciones";

test.describe("Flujo 101: carreras visibles por umbral", () => {
  test("el sitemap lista una carrera siempre visible y no la forzada a oculta", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("/mercado/data_analyst");
    expect(body).not.toContain(`/mercado/${HIDDEN}`);
  });

  test("los chips de /mercado y /ofertas muestran una carrera siempre visible y no la oculta", async ({
    page,
  }) => {
    for (const path of ["/mercado", "/ofertas"]) {
      await page.goto(path);
      const chips = page.getByRole("navigation", { name: "Carreras" });
      await expect(chips.getByRole("link").first()).toBeVisible();
      await expect(chips.locator(`a[href$="/data_analyst"]`)).toHaveCount(1);
      await expect(chips.getByRole("link", { name: HIDDEN_LABEL })).toHaveCount(0);
    }
  });

  test("la página de una carrera oculta responde pero no se indexa", async ({ page }) => {
    const res = await page.goto(`/mercado/${HIDDEN}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    // La carrera actual se muestra entre los chips aunque esté oculta (para poder cambiar de carrera)
    await expect(
      page.getByRole("navigation", { name: "Cambiar de carrera" }).getByRole("link", {
        name: HIDDEN_LABEL,
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("una carrera siempre visible no lleva noindex", async ({ page }) => {
    await page.goto("/mercado/data_analyst");
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });
});
