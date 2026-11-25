import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import { reach } from "./teclado-helpers";
import { cleanB, openInterview, prepareB } from "./voz-helpers";

/**
 * Flujo 297 (R28-08): una pregunta de la simulación de Interview solo con teclado. Se llega con Tab al campo,
 * se escribe, se llega a «Enviar respuesta» y se envía con Enter. Mientras se evalúa hay un `role="status"`; al
 * llegar la devolución el foco va a ella (antes se perdía: el formulario se desmontaba) y Tab llega a
 * «Siguiente pregunta»; con Enter el foco vuelve al campo de la pregunta siguiente. Persona B (ficticia), con
 * el modelo simulado.
 */
test.use({ viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

test.afterAll(async () => {
  await cleanB().catch(() => {});
  await removeSecondUser().catch(() => {});
});

test("pregunta, respuesta, devolución y siguiente pregunta, solo con teclado", async ({ page }) => {
  const id = await prepareB("Simulación ficticia del teclado");
  await openInterview(page, id);
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 1 de 5");

  const campo = page.getByTestId("interview-answer");
  await reach(page, campo, "Tu respuesta");
  await page.keyboard.insertText(
    "En un proyecto ficticio ordené los pedidos atrasados: armé una lista, la prioricé con el equipo y bajé los atrasos a la mitad.",
  );

  const enviar = page.getByTestId("interview-send");
  await reach(page, enviar, "Enviar respuesta");
  await page.keyboard.press("Enter");

  // La devolución llegó y tiene el foco (nombre accesible: «Devolución de tu respuesta»)
  const devolucion = page.getByTestId("interview-feedback-foco");
  await expect(devolucion).toBeVisible({ timeout: 45_000 });
  await expect(devolucion, "al llegar la devolución, el foco va a ella").toBeFocused();
  await expect(page.getByRole("region", { name: "Devolución de tu respuesta" })).toBeVisible();

  const siguiente = page.getByTestId("interview-next");
  await reach(page, siguiente, "Siguiente pregunta");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 2 de 5");
  await expect(page.getByTestId("interview-answer"), "el foco vuelve al campo").toBeFocused();
});
