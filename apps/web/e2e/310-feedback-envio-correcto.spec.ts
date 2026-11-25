import { expect, test } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { OPERA_GX_UA } from "./voz-helpers";
import { clearFeedbackOf, feedbackOf } from "./recorrido-helpers";

/**
 * Flujo 310 (R29-01): el envío correcto del modal «¿Algo no anduvo?» con texto escrito, en tres navegadores
 * simulados (Chrome de escritorio, Chrome a 390 px y Opera GX a 390 px). Guarda el comentario, agradece y borra el
 * borrador (solo ahí). Datos inventados.
 */
const DRAFT_KEY = "jso:feedback-borrador:v1";

const PERFILES = [
  { nombre: "Chrome de escritorio", viewport: { width: 1280, height: 800 }, userAgent: undefined },
  { nombre: "Chrome a 390 px", viewport: { width: 390, height: 800 }, userAgent: undefined },
  { nombre: "Opera GX a 390 px", viewport: { width: 390, height: 800 }, userAgent: OPERA_GX_UA },
] as const;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
});
test.afterAll(async () => {
  await clearFeedbackOf();
  await removeSecondUser();
});

for (const perfil of PERFILES) {
  test.describe(perfil.nombre, () => {
    test.use({
      viewport: perfil.viewport,
      ...(perfil.userAgent ? { userAgent: perfil.userAgent } : {}),
    });
    test.beforeEach(async () => {
      await clearFeedbackOf();
    });

    test("escribir y enviar guarda el comentario, agradece y borra el borrador", async ({
      page,
    }) => {
      await loginAsSecondUser(page);
      await page.goto("/hoy");
      await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
      const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
      await expect(dialog).toBeVisible();

      await dialog.getByRole("radio", { name: "Algo es confuso" }).check();
      const mensaje = `Comentario ficticio 310 en ${perfil.nombre}`;
      await dialog.getByLabel("Tu mensaje").fill(mensaje);

      // Mientras se escribe, el borrador está en sessionStorage (clave sin datos de la persona)
      const borrador = await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY);
      expect(borrador).toContain(mensaje);
      expect(borrador).not.toContain("@");

      await dialog.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();
      await expect(dialog).toBeHidden();

      const [row] = await feedbackOf(E2E_B_USER_ID);
      expect(row?.message).toBe(mensaje);
      expect(row?.category).toBe("confuso");
      expect(row?.path).toBe("/hoy");

      // El borrador se borró recién con el «¡Gracias!» y el modal vuelve a abrirse vacío
      expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toBeNull();
      await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
      await expect(dialog.getByLabel("Tu mensaje")).toHaveValue("");
      await expect(dialog.getByRole("radio", { name: "Algo es confuso" })).not.toBeChecked();
    });
  });
}
