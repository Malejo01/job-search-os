import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { limpiarSemilla, sembrarOfertas, type SemillaOferta } from "./cobertura-semilla";

/**
 * Flujo 404 (R32-02): el semáforo del panel `/admin/cobertura` (solo admin). Se siembran 40 ofertas tomables,
 * 10 de ellas para quien empieza, en una carrera de la beta: pasa a verde (umbral 30 y 10). Además, en toda
 * carrera el estado tiene que coincidir con sus números. Las carreras en rojo dependen de lo que ya haya en
 * la base de prueba, así que no se fuerzan: se comprueba la coherencia, no un color fijo. Necesita una
 * cuenta admin: en el CI lo es (`E2E_EMAIL` está en `ADMIN_EMAILS`); en local no, y el flujo se saltea.
 */
test.describe.configure({ mode: "serial" });

const PREFIX = "cobertura-404-e2e-";
const ROLE = "relaciones_publicas";

const ofertas: SemillaOferta[] = Array.from({ length: 40 }, (_, i) => ({
  paises: ["AR"],
  vistaHace: 1,
  junior: i < 10,
  idioma: "es",
}));

test.describe("Flujo 404: semáforo de cobertura", () => {
  test.beforeAll(() => limpiarSemilla(PREFIX));
  test.afterAll(() => limpiarSemilla(PREFIX));

  test("una carrera con 40 tomables y 10 para quien empieza queda en verde", async ({ page }) => {
    await login(page);
    const response = await page.goto("/admin/cobertura");
    test.skip(response?.status() === 404, "La cuenta e2e no es admin en este entorno");
    await expect(
      page.getByRole("heading", { level: 1, name: "Cobertura por carrera" }),
    ).toBeVisible();
    await expect(page.getByTestId("cobertura-carrera")).toHaveCount(8);

    await sembrarOfertas(PREFIX, ROLE, ofertas);
    await page.reload();
    const card = page.locator(`[data-role="${ROLE}"]`);
    await expect(card).toHaveAttribute("data-semaforo", "verde");
    await expect(card.getByTestId("cobertura-estado")).toContainText("Lista para abrir");
    await expect(card.getByTestId("cobertura-fuente").first()).toContainText("tomables de");
  });

  test("en cada carrera el estado coincide con sus números", async ({ page }) => {
    await login(page);
    const response = await page.goto("/admin/cobertura");
    test.skip(response?.status() === 404, "La cuenta e2e no es admin en este entorno");
    const cards = page.getByTestId("cobertura-carrera");
    const total = await cards.count();
    expect(total).toBe(8);
    for (let i = 0; i < total; i++) {
      const card = cards.nth(i);
      const num = async (id: string) =>
        Number(((await card.getByTestId(id).innerText()).match(/^\d+/) ?? ["0"])[0]);
      const tomables = await num("cobertura-tomables");
      const empieza = await num("cobertura-empieza");
      const vigentes = await num("cobertura-vigentes");
      expect(tomables).toBeLessThanOrEqual(vigentes);
      expect(empieza).toBeLessThanOrEqual(tomables);
      const esperado =
        tomables >= 30 && empieza >= 10
          ? "verde"
          : tomables >= 15 && empieza >= 5
            ? "amarillo"
            : "rojo";
      await expect(card).toHaveAttribute("data-semaforo", esperado);
    }
  });
});
