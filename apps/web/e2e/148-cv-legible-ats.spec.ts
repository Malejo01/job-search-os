import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 148 (R14-2): «¿Tu CV es legible por los filtros (ATS)?» en `/cv/perfil`. El veredicto se calcula en el
 * navegador con el texto del cuadro: no hay ningún pedido nuevo al servidor y nada se guarda. La persona seed es
 * admin, así que es tester del agente de perfil (`CV_PROFILE_AGENT=testers`). CVs de prueba inventados.
 * No corre en local: lo corre el CI.
 */
const FILLER =
  "Armé reportes semanales para el equipo comercial y automaticé tareas repetitivas con herramientas internas. " +
  "Trabajé con distintas áreas para entender qué necesitaban y presentar los resultados de forma clara.";

const WELL_BUILT = [
  "Persona Ejemplo",
  "candidata.prueba@example.com | 011 4000 1234",
  "",
  "Experiencia laboral",
  "Analista de datos - Empresa A",
  "03/2021 - actual",
  FILLER,
  "Uso SQL y Excel todos los días, y armo tableros.",
  "Asistente administrativa - Empresa B",
  "marzo 2018 - febrero 2021",
  FILLER,
  "",
  "Educación",
  "Licenciatura en Estadística - Universidad A",
  "2013 - 2018",
  "",
  "Habilidades",
  "SQL, Excel, Python, comunicación, trabajo en equipo",
  FILLER,
].join("\n");

const TWO_COLUMNS = WELL_BUILT.replace(
  "Experiencia laboral",
  "Experiencia laboral          Habilidades",
).replace("Educación\n", "Educación          Contacto\n");

test.describe("Flujo 148: CV legible por los filtros (ATS)", () => {
  test("veredicto en el navegador: legible, columnas y escaneado, sin pedidos al servidor", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/cv/perfil");
    const text = page.getByTestId("profile-read-text");
    const run = page.getByTestId("ats-check-run");
    const verdict = page.getByTestId("ats-verdict");
    await expect(text).toBeVisible();

    // desde acá, ningún pedido de la app: el cálculo no sale del navegador
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) requests.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });

    // 1. CV bien armado: entre 3 y 5 puntos, y el texto habla de «legible por los filtros»
    await text.fill(WELL_BUILT);
    await run.click();
    await expect(page.getByTestId("ats-report")).toBeVisible();
    await expect(verdict).toHaveText(/Legible/);
    const points = page.getByTestId("ats-point");
    expect(await points.count()).toBeGreaterThanOrEqual(3);
    expect(await points.count()).toBeLessThanOrEqual(5);
    await expect(page.getByTestId("ats-check")).toContainText("legible por los filtros");
    await expect(page.getByTestId("ats-check")).not.toContainText(/pasa(r|s)? (los )?filtros/i);

    // 2. Cambiar el texto borra el resultado anterior
    await text.fill(TWO_COLUMNS);
    await expect(page.getByTestId("ats-report")).toHaveCount(0);
    await run.click();
    await expect(page.getByTestId("ats-report")).toBeVisible();
    await expect(verdict).not.toHaveAttribute("data-verdict", "legible");
    await expect(
      page.locator('[data-testid="ats-point"][data-status="bad"]').filter({
        hasText: "salió desordenado",
      }),
    ).toHaveCount(1);

    // 3. Sin texto (escaneo): «Difícil de leer» y la causa primero
    await text.fill("");
    await run.click();
    await expect(verdict).toHaveAttribute("data-verdict", "dificil");
    await expect(verdict).toHaveText("Difícil de leer");
    await expect(points.first()).toContainText("imagen o un escaneo");

    expect(requests).toEqual([]);
  });
});
