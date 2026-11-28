import { expect, test } from "@playwright/test";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";
import { cleanB, seedInterviewSession } from "./voz-helpers";

/**
 * Flujo 237 (R26-03): «Abrir» lleva a la pantalla real con los datos de quien revisa: la primera oferta y la
 * primera simulación se resuelven en el servidor. Sin esos datos cae en la lista y explica cómo llegar. El primer
 * uso se vuelve a mostrar. Datos inventados de la persona B.
 */
test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("con una oferta y una simulación propias, «Abrir» lleva directo a ellas", async ({ page }) => {
  const tag = Date.now();
  const { jobId } = await seedSecondUserData(tag);
  const sessionId = await seedInterviewSession(E2E_B_USER_ID, `Simulación ficticia ${tag}`);
  await loginAsSecondUser(page);
  await page.goto("/recorrido");

  await expect(
    page.getByTestId("recorrido-match-oferta").getByRole("link", { name: /Abrir/ }),
  ).toHaveAttribute("href", `/jobs/${jobId}`);
  await expect(
    page.getByTestId("recorrido-match-preparar").getByRole("link", { name: /Abrir/ }),
  ).toHaveAttribute("href", `/jobs/${jobId}/postular`);
  await expect(
    page.getByTestId("recorrido-interview-pregunta").getByRole("link", { name: /Abrir/ }),
  ).toHaveAttribute("href", `/interview/${sessionId}`);
  // Con todo resuelto no hace falta explicar cómo llegar
  await expect(
    page.getByTestId("recorrido-match-oferta").getByTestId("recorrido-como-llegar"),
  ).toHaveCount(0);

  await page.getByTestId("recorrido-match-oferta").getByRole("link", { name: /Abrir/ }).click();
  await page.waitForURL(`**/jobs/${jobId}`);
  await expect(page.getByText(`Oferta Ficticia B ${tag}`).first()).toBeVisible();
});

test("sin datos propios, «Abrir» cae en la lista y dice cómo llegar", async ({ page }) => {
  await removeSecondUser();
  await ensureSecondUser();
  await loginAsSecondUser(page);
  await page.goto("/recorrido");

  const oferta = page.getByTestId("recorrido-match-oferta");
  await expect(oferta.getByRole("link", { name: /Abrir/ })).toHaveAttribute("href", "/jobs");
  await expect(oferta.getByTestId("recorrido-como-llegar")).toContainText("sumá una");
  const pregunta = page.getByTestId("recorrido-interview-pregunta");
  await expect(pregunta.getByRole("link", { name: /Abrir/ })).toHaveAttribute("href", "/interview");
  await expect(pregunta.getByTestId("recorrido-como-llegar")).toContainText("Todavía no hiciste");
});

test("«Abrir» el primer uso vuelve a mostrar el recorrido en Hoy", async ({ page }) => {
  await ensureSecondUser();
  await loginAsSecondUser(page);
  // Un navegador automatizado no ve el diálogo salvo que se lo fuerce (components/primer-uso.tsx). Se fuerza solo
  // al llegar a Hoy, con un script de inicio, y NO desde la página del recorrido: ahí el diálogo es modal y se
  // abre en cuanto el componente vuelve a leer el almacenamiento (por ejemplo al terminar de hidratar, que en el CI
  // pasa después de un `page.evaluate`), con lo que tapaba el botón «Abrir» y el click esperaba hasta el timeout.
  await page.addInitScript(() => {
    if (location.pathname.startsWith("/hoy")) localStorage.setItem("jso-primer-uso-forzar", "1");
  });
  await page.goto("/recorrido");
  await page.getByTestId("recorrido-primer-uso").getByRole("button", { name: /Abrir/ }).click();
  await page.waitForURL("**/hoy");
  await expect(page.getByTestId("primer-uso")).toBeVisible();
});
