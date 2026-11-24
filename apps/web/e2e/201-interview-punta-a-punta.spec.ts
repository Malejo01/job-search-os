import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { axeSummary } from "./axe-helpers";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 201 (R24-02): Interview de punta a punta, todo por la interfaz y con el modelo simulado
 * (`LLM_DEMO=1`, sin red ni gasto): empezar desde el formulario (carrera y nivel), responder las cinco
 * preguntas con su devolución, ver el resumen con el informe, encontrarla en el historial como terminada y
 * borrarla. Lo que ya cubren 180 a 182 (informe con puntajes conocidos, skeleton, tope diario, 404) no se
 * repite. Persona B (ficticia); no correr junto con otros flujos de la persona B. Datos inventados.
 */
const ANSWER =
  "Cuando el cierre mensual tardaba dos días en mi proyecto, armé un tablero con SQL y logré bajarlo a una hora, un 80% menos.";

test.describe.configure({ mode: "serial" });

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

test.beforeAll(async () => {
  await ensureSecondUser();
  await clean();
});

test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

test("empezar sin carrera no hace nada; con carrera arma cinco preguntas y abre la primera", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await expect(page.getByTestId("interview-vacio")).toBeVisible();

  await page.getByLabel("Una carrera y un nivel", { exact: true }).check();
  // Sin carrera el botón está deshabilitado (aria-disabled): Playwright no lo clickea; se fuerza y no pasa nada
  const start = page.getByTestId("interview-start-button");
  await expect(start).toHaveAttribute("aria-disabled", "true");
  await start.click({ force: true });
  await expect(page).toHaveURL(/\/interview$/);

  await page.getByLabel("Carrera o puesto").fill("Analista de datos");
  await page.getByLabel("Nivel", { exact: true }).selectOption({ index: 1 });
  await expect(start).toHaveAttribute("aria-disabled", "false");
  await start.click();
  await page.waitForURL(/\/interview\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 1 de 5");
  await expect(page.getByTestId("interview-question")).not.toBeEmpty();
});

test("responde las cinco preguntas, ve el resumen con el informe y la encuentra terminada", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await page.getByRole("link", { name: "Seguir practicando" }).click();
  await page.waitForURL(/\/interview\/[0-9a-f-]{36}$/);

  for (let n = 1; n <= 5; n++) {
    await expect(page.getByTestId("interview-progress-label")).toHaveText(`Pregunta ${n} de 5`);
    await page.getByTestId("interview-answer").fill(ANSWER);
    await page.getByTestId("interview-send").click();
    await expect(page.getByTestId("interview-feedback")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("interview-tip")).not.toBeEmpty();
    await page.getByTestId("interview-next").click();
  }

  await expect(page.getByTestId("interview-summary")).toBeVisible();
  await expect(page.getByTestId("interview-report")).toBeVisible();
  await expect(page.getByTestId("interview-summary").getByRole("listitem")).toHaveCount(5);
  const { violations } = await axeSummary(page);
  expect(violations).toEqual([]);

  await page.getByRole("link", { name: "Volver a Interview" }).click();
  await expect(page).toHaveURL(/\/interview$/);
  const history = page.getByTestId("interview-history");
  await expect(history).toContainText("Terminada");
  await expect(history.getByRole("link", { name: "Ver resumen" })).toBeVisible();
  // Con una terminada ya hay dato para la tabla de evolución
  await expect(page.getByTestId("interview-progress")).toBeVisible();
});

test("borrar la simulación pide confirmación en pantalla y deja el vacío", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await page.getByTestId("interview-delete").click();
  await expect(page.getByTestId("interview-delete-confirm")).toBeVisible();
  // Cancelar no borra
  await page.getByTestId("interview-delete-cancel").click();
  await expect(page.getByTestId("interview-history")).toBeVisible();
  await page.getByTestId("interview-delete").click();
  await page.getByTestId("interview-delete-yes").click();
  await expect(page.getByTestId("interview-vacio")).toBeVisible();
});
