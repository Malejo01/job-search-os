import { expect, test } from "@playwright/test";
import { ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";

/**
 * Flujo 377 (R31-10): quien no tiene `JOB_CARD` (una persona sin rol, que no es admin ni tester) no ve el kit de
 * calibración: `/calibracion` y la exportación responden 404 y no hay ningún link. Vale con la variable apagada
 * y también encendida en `testers` (la persona sin rol no está en la lista). No usa la persona A: en el CI es admin.
 */
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureOffUser();
});
test.afterAll(async () => {
  await removeOffUser();
});

test("una persona sin rol recibe 404 en /calibracion y en la exportación", async ({ page }) => {
  await loginAsOffUser(page);
  expect((await page.goto("/calibracion"))?.status()).toBe(404);
  expect((await page.request.get("/admin/calibracion/export")).status()).toBe(404);
});
