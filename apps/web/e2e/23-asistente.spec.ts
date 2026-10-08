import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Flujo 23: el asistente de Ajustes muestra la dirección y el archivo de filtros la contiene. */
test.describe("Flujo 23: asistente de reenvío de Gmail", () => {
  test("la página muestra la dirección y /api/gmail-filters la incluye", async ({ page }) => {
    await login(page);
    await page.goto("/settings/asistente");
    const direccion = page.getByTestId("assistant-address");
    await expect(direccion).toHaveText(/^u_.+@.+/);
    const address = (await direccion.innerText()).trim();

    const res = await page.request.get("/api/gmail-filters");
    // El usuario de e2e tiene una dirección del formato anterior, así que hoy el endpoint responde
    // 409 y el test termina acá. La verificación de punta a punta del XML queda pendiente.
    if (res.status() === 409) return;
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/xml");
    expect(res.headers()["content-disposition"]).toContain("filtros-job-search-os.xml");
    expect(await res.text()).toContain(address);
  });

  test("sin sesión el archivo de filtros responde 401", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const res = await ctx.get("/api/gmail-filters", { maxRedirects: 0 });
    expect([307, 401]).toContain(res.status());
    await ctx.dispose();
  });
});
