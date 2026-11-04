import { expect, test } from "@playwright/test";
import { createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 117 (C9-13, F2): un error de guardado se avisa en el lugar y no se pierde lo escrito. En
 * «Sin descripción», una descripción demasiado corta vuelve con error: el texto sigue en el campo,
 * el aviso aparece junto a él y el foco queda ahí. Datos inventados.
 */
test.describe("Flujo 117: error de guardado sin perder el texto", () => {
  const tag = Date.now();
  const title = `E2E error de guardado ${tag}`;
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createJob({ title, status: "pendiente_jd", jdText: null });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("descripción corta: aviso en el lugar y el texto sigue en el campo", async ({ page }) => {
    await login(page);
    await page.goto("/jobs/pending-jd");
    const field = page.getByLabel(`Descripción de ${title}`);
    // El navegador pide 200 caracteres (minLength) y el servidor cuenta sin los espacios de los
    // bordes: con espacios al final pasa el navegador y el servidor la rechaza por corta
    const text = `Texto ficticio demasiado corto para un aviso.${" ".repeat(220)}`;
    await field.fill(text);
    const item = page.getByRole("listitem").filter({ has: field });
    await item.getByRole("button", { name: "Guardar descripción y evaluar" }).click();
    // El redirect de la acción es una navegación del cliente: no hay evento «load»
    await page.waitForURL(/error=corta/, { waitUntil: "commit" });
    const again = page.getByLabel(`Descripción de ${title}`);
    await expect(again).toHaveValue(text);
    await expect(again).toBeFocused();
    const notice = page.getByTestId("jd-error-en-lugar");
    await expect(notice).toContainText("No pudimos guardar la descripción.");
    await expect(notice).toContainText("Tu texto sigue acá.");
  });
});
