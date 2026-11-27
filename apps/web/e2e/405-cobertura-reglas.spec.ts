import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { limpiarSemilla, sembrarOfertas, type SemillaOferta } from "./cobertura-semilla";

/**
 * Flujo 405 (R32-02): las reglas de vigente, tomable, para quien empieza y español, vistas en el panel. Se
 * siembran 7 ofertas inventadas en una carrera de la beta y se comprueba que los números suben en la cantidad
 * exacta (los de antes no importan: se leen antes y después). Necesita una cuenta admin: en local no lo es y el
 * flujo se saltea; en el CI sí.
 */
test.describe.configure({ mode: "serial" });

const PREFIX = "cobertura-405-e2e-";
const ROLE = "marketing_digital";

const ofertas: SemillaOferta[] = [
  { paises: ["AR"], vistaHace: 1, idioma: "es" }, // vigente, tomable, español
  { paises: ["LATAM"], vistaHace: 6, junior: true, idioma: "en" }, // su región, para empezar
  { paises: ["Worldwide"], vistaHace: 3, junior: true }, // todo el mundo, para empezar
  { paises: null, vistaHace: 2, idioma: "es" }, // sin países: vigente, no tomable
  { paises: ["US"], vistaHace: 2 }, // otro país: vigente, no tomable
  { paises: ["AR"], vistaHace: 9, junior: true, idioma: "es" }, // ya no vigente: no cuenta en nada
  { paises: null, lugar: "Buenos Aires, Argentina", vistaHace: 1 }, // lugar de trabajo en Argentina
];

test.describe("Flujo 405: reglas de cobertura", () => {
  test.beforeAll(() => limpiarSemilla(PREFIX));
  test.afterAll(() => limpiarSemilla(PREFIX));

  test("vigentes, tomables, para quien empieza y español suben en la cantidad exacta", async ({
    page,
  }) => {
    await login(page);
    const response = await page.goto("/admin/cobertura");
    test.skip(response?.status() === 404, "La cuenta e2e no es admin en este entorno");

    const card = page.locator(`[data-role="${ROLE}"]`);
    const num = async (id: string) =>
      Number(((await card.getByTestId(id).innerText()).match(/^\d+/) ?? ["0"])[0]);
    const antes = {
      vigentes: await num("cobertura-vigentes"),
      tomables: await num("cobertura-tomables"),
      empieza: await num("cobertura-empieza"),
      espanol: await num("cobertura-espanol"),
    };

    await sembrarOfertas(PREFIX, ROLE, ofertas);
    await page.reload();
    await expect(card.getByTestId("cobertura-vigentes")).toBeVisible();
    expect(await num("cobertura-vigentes")).toBe(antes.vigentes + 6);
    expect(await num("cobertura-tomables")).toBe(antes.tomables + 4);
    expect(await num("cobertura-empieza")).toBe(antes.empieza + 2);
    expect(await num("cobertura-espanol")).toBe(antes.espanol + 2);

    // Las definiciones están a mano y la pantalla no muestra avisos
    await page.getByText("Cómo se cuenta").click();
    await expect(page.getByText("si no dice países, no cuenta", { exact: false })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Empresa Ficticia");
    await expect(page.locator("main")).not.toContainText("example.com");
  });
});
