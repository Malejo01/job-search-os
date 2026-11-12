import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 127 (R5-C9, hallazgos 30 y 33 de `docs/ux/auditoria-r4.md`): dos anchos de contenedor
 * (lista: Hoy y Ofertas; lectura: CV y Ajustes) y el glosario de /ayuda. Todo inventado.
 */
test.describe("Flujo 127: anchos coherentes y glosario", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("las pantallas de lectura arrancan en el mismo margen izquierdo", async ({ page }) => {
    await login(page);
    const xs: Record<string, number> = {};
    for (const path of ["/cv", "/settings", "/settings/perfil", "/settings/skills"]) {
      await page.goto(path);
      const box = await page.getByRole("heading", { level: 1 }).first().boundingBox();
      expect(box, `h1 de ${path}`).not.toBeNull();
      xs[path] = Math.round(box!.x);
    }
    const values = Object.values(xs);
    expect(Math.max(...values) - Math.min(...values), JSON.stringify(xs)).toBeLessThanOrEqual(2);
  });

  test("Hoy y Ofertas (lista) comparten el margen izquierdo", async ({ page }) => {
    await login(page);
    await page.goto("/hoy");
    const hoy = await page.getByRole("heading", { level: 1 }).first().boundingBox();
    await page.goto("/jobs");
    const jobs = await page.getByRole("heading", { level: 1, name: "Tus ofertas" }).boundingBox();
    expect(hoy).not.toBeNull();
    expect(jobs).not.toBeNull();
    expect(Math.abs(hoy!.x - jobs!.x)).toBeLessThanOrEqual(2);
  });

  test("/ayuda tiene el glosario con puntaje, afín, prefiltro y pool", async ({ page }) => {
    await page.goto("/ayuda");
    const glosario = page.getByRole("region", { name: /Glosario/ });
    await expect(glosario).toBeVisible();
    for (const term of ["Puntaje", "Afín", "Prefiltro", "Pool"]) {
      await expect(
        glosario.getByRole("term").filter({ hasText: new RegExp(`^${term}$`) }),
      ).toHaveCount(1);
    }
  });
});
