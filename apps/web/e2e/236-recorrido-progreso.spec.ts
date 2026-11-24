import { expect, test } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { TOTAL_PANTALLAS } from "./recorrido-helpers";

/**
 * Flujo 236 (R26-03): «Revisaste N de M» se guarda en este navegador (localStorage). Marcar sube el número, recargar
 * lo conserva, desmarcar lo baja y «Empezar de cero» lo limpia. Un valor guardado roto no rompe la pantalla.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
});
test.afterAll(async () => {
  await removeSecondUser();
});

const progreso = (n: number) => `Revisaste ${n} de ${TOTAL_PANTALLAS}`;

test("marcar pantallas sube el número y sobrevive a recargar; desmarcar y empezar de cero lo bajan", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/recorrido");
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith("jso-recorrido:")) localStorage.removeItem(k);
  });
  await page.reload();
  const estado = page.getByTestId("recorrido-progreso");
  await expect(estado).toHaveText(progreso(0));

  await page
    .getByTestId("recorrido-hoy")
    .getByLabel(/Ya la revisé/)
    .check();
  await page
    .getByTestId("recorrido-plan")
    .getByLabel(/Ya la revisé/)
    .check();
  await expect(estado).toHaveText(progreso(2));

  await page.reload();
  await expect(estado).toHaveText(progreso(2));
  await expect(page.getByTestId("recorrido-hoy").getByLabel(/Ya la revisé/)).toBeChecked();

  await page
    .getByTestId("recorrido-hoy")
    .getByLabel(/Ya la revisé/)
    .uncheck();
  await expect(estado).toHaveText(progreso(1));

  await page.getByRole("button", { name: "Empezar de cero" }).click();
  await expect(estado).toHaveText(progreso(0));
  await expect(page.getByRole("button", { name: "Empezar de cero" })).toHaveCount(0);
});

test("un valor guardado roto o con pantallas que no existen se ignora", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/recorrido");
  const key = `jso-recorrido:r26:${E2E_B_USER_ID}`;
  await page.evaluate((k) => localStorage.setItem(k, "esto no es json"), key);
  await page.reload();
  await expect(page.getByTestId("recorrido-progreso")).toHaveText(progreso(0));

  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify(["hoy", "inventada", 7])), key);
  await page.reload();
  await expect(page.getByTestId("recorrido-progreso")).toHaveText(progreso(1));
  await page.getByRole("button", { name: "Empezar de cero" }).click();
});
