import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";
import { TOTAL_PANTALLAS } from "./recorrido-helpers";

/**
 * Flujo 235 (R26-03): `/recorrido` es solo para admins y testers. Una tester (la persona B, por
 * `ASSISTANT_TESTER_EMAILS`) ve la lista agrupada como el menú y el link en Ajustes y en «Más»; una persona común
 * recibe 404 y no ve ningún link. Datos inventados.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
  await ensureOffUser();
});
test.afterAll(async () => {
  await removeOffUser();
  await removeSecondUser();
});

const GRUPOS = [
  "Hoy",
  "Match",
  "CV",
  "Tracker",
  "Interview",
  "Academy",
  "Plan",
  "Primer uso",
  "Pantallas vacías",
];

test("una tester ve la lista agrupada, con qué es y tres cosas para mirar en cada pantalla", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  const res = await page.goto("/recorrido");
  expect(res?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Recorrido para revisar" }),
  ).toBeVisible();
  for (const g of GRUPOS) {
    await expect(page.getByRole("heading", { level: 2, name: g, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^Comentar esta pantalla/ })).toHaveCount(
    TOTAL_PANTALLAS,
  );
  const hoy = page.getByTestId("recorrido-hoy");
  await expect(hoy.getByRole("heading", { level: 3, name: "Hoy" })).toBeVisible();
  await expect(hoy.getByText("Qué mirar")).toBeVisible();
  await expect(hoy.locator("ul li")).toHaveCount(3);
  await expect(hoy.getByRole("link", { name: /Abrir/ })).toHaveAttribute("href", "/hoy");
  await expect(page.getByTestId("recorrido-progreso")).toHaveText(
    `Revisaste 0 de ${TOTAL_PANTALLAS}`,
  );
});

test("el link aparece en Ajustes y en «Más» solo para quien puede verlo", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/settings");
  await expect(page.getByTestId("ajustes-recorrido")).toHaveAttribute("href", "/recorrido");
  await page.goto("/settings/perfil");
  await expect(
    page.getByTestId("mas").getByRole("link", { name: /Recorrido para revisar/ }),
  ).toBeVisible();
});

test("una persona común recibe 404 y no ve el link", async ({ page }) => {
  await loginAsOffUser(page);
  expect((await page.goto("/recorrido"))?.status()).toBe(404);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
  await expect(page.getByTestId("ajustes-recorrido")).toHaveCount(0);
  await page.goto("/settings/perfil");
  await expect(page.getByTestId("mas")).toBeVisible();
  await expect(
    page.getByTestId("mas").getByRole("link", { name: /Recorrido para revisar/ }),
  ).toHaveCount(0);
});
