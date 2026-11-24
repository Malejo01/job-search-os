import { splitFeedbackSuggestion } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";
import { clearFeedbackOf, feedbackOf } from "./recorrido-helpers";

/**
 * Flujo 238 (R26-03 y R26-04): «Comentar esta pantalla» en `/recorrido` abre el feedback con la pantalla ya elegida;
 * el comentario guarda la ruta normalizada (sin ids) y la sugerencia opcional «¿Qué te gustaría que cambie?».
 * El botón «¿Algo no anduvo?» de siempre sigue andando y guarda la pantalla actual sin ids. Datos inventados.
 */
test.use({ viewport: { width: 390, height: 800 } });
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
  await clearFeedbackOf();
});
test.afterAll(async () => {
  await clearFeedbackOf();
  await removeSecondUser();
});

test("comentar una pantalla del recorrido: ya viene elegida y guarda la ruta sin ids, con la sugerencia", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/recorrido");
  await page
    .getByTestId("recorrido-match-transparencia")
    .getByRole("button", { name: /Comentar esta pantalla/ })
    .click();

  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("feedback-pantalla")).toHaveText(
    "Estás comentando: Transparencia del aviso",
  );
  await dialog.getByRole("radio", { name: "Algo es confuso" }).check();
  await dialog.getByLabel("Tu mensaje").fill("No entiendo qué mide este bloque");
  await dialog.getByLabel("¿Qué te gustaría que cambie?").fill("Que diga «del aviso» más grande");
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();

  const [row] = await feedbackOf(E2E_B_USER_ID);
  expect(row?.path).toBe("/jobs/[id]");
  expect(row?.category).toBe("confuso");
  expect(row?.context?.pathname).toBe("/jobs/[id]");
  expect(row?.context?.pageTitle).toBe("Transparencia del aviso");
  expect(splitFeedbackSuggestion(row!.message)).toEqual({
    message: "No entiendo qué mide este bloque",
    suggestion: "Que diga «del aviso» más grande",
  });
});

test("el botón de siempre guarda la pantalla actual sin ids y la sugerencia es opcional", async ({
  page,
}) => {
  const { jobId } = await seedSecondUserData(Date.now());
  await loginAsSecondUser(page);
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  // Abierto con el botón, no con el recorrido: no hay pantalla elegida de antemano
  await expect(dialog.getByTestId("feedback-pantalla")).toHaveCount(0);
  await expect(dialog.getByText("(opcional)")).toBeVisible();
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  await dialog.getByLabel("Tu mensaje").fill("Sin sugerencia aparte");
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();

  const [row] = await feedbackOf(E2E_B_USER_ID);
  expect(row?.path).toBe("/jobs/[id]");
  expect(row?.path).not.toContain(jobId);
  expect(row?.context?.pathname).toBe("/jobs/[id]");
  expect(splitFeedbackSuggestion(row!.message)).toEqual({
    message: "Sin sugerencia aparte",
    suggestion: null,
  });
});

test("una sugerencia pasada de largo avisa y no guarda nada", async ({ page }) => {
  await clearFeedbackOf();
  await loginAsSecondUser(page);
  await page.goto("/hoy");
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  await dialog.getByLabel("Tu mensaje").fill("Mensaje corto");
  await dialog.getByLabel("¿Qué te gustaría que cambie?").fill("x".repeat(501));
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("La sugerencia es muy larga");
  expect(await feedbackOf(E2E_B_USER_ID)).toEqual([]);
});
