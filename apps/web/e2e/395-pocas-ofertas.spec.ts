import { expect, test } from "@playwright/test";
import { borrarPersonaAlta, crearPersonaAlta, entrarComo, type PersonaAlta } from "./alta-helpers";

/**
 * Flujo 395 (R32-04): estado vacío por carrera. Una persona cuya carrera tiene pocas ofertas esta semana lo lee sin
 * vueltas en «Tus ofertas», con la cantidad, y tiene dos caminos: la guía de alertas paso a paso o cargar una
 * oferta. «Ahora no» lo oculta unos días. Persona inventada; usa una carrera sin avisos sembrados (el volumen es del
 * mercado por carrera y se cachea 30 minutos: si la base local trae 5 o más avisos de esta carrera, el spec no aplica).
 */
const P: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000397",
  email: `pocas-ofertas-${Date.now()}@ejemplo.test`,
  password: "clave-e2e-pocas-ofertas-local",
  name: "Persona Pocas Ofertas",
};

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  await crearPersonaAlta(P, { targetRoles: ["relaciones_publicas"], careerAskedAt: new Date() });
});
test.afterAll(async () => {
  await borrarPersonaAlta(P.id).catch(() => {});
});

test("Flujo 395: lo dice sin vueltas, con la cantidad y dos caminos", async ({ page }) => {
  await entrarComo(page, P);
  await page.goto("/jobs");
  const aviso = page.getByTestId("pocas-ofertas");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Hay pocas ofertas de Relaciones públicas");
  await expect(aviso).toContainText("esta semana");
  await expect(page.getByTestId("pocas-ofertas-filas")).toContainText(
    "Relaciones públicas: 0 esta semana",
  );
  await expect(aviso).toContainText("menos de 5");

  // Los dos caminos, con área táctil de 44 px
  const guia = page.getByTestId("pocas-ofertas-guia");
  const cargar = page.getByTestId("pocas-ofertas-cargar");
  for (const link of [guia, cargar]) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(cargar).toHaveAttribute("href", "/jobs/new");

  await guia.click();
  await expect(page).toHaveURL(/\/settings\/asistente/);
  await expect(page.getByTestId("alert-guide")).toBeVisible();
});

test("«Ahora no» lo oculta y no vuelve al recargar", async ({ page }) => {
  await entrarComo(page, P);
  await page.goto("/jobs");
  await expect(page.getByTestId("pocas-ofertas")).toBeVisible();
  await page.getByTestId("pocas-ofertas").getByRole("button", { name: "Ahora no" }).click();
  await expect(page.getByTestId("pocas-ofertas")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("pocas-ofertas")).toHaveCount(0);
});
