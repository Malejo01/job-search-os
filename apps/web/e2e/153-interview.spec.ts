import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 153 (R17-08): simulador de entrevistas en `/interview`, con el modelo simulado (`LLM_DEMO=1`, sin
 * red ni gasto). Una persona practica con una oferta suya: 5 preguntas («Pregunta N de 5»), una devolución
 * por respuesta (claridad, relevancia y STAR de 0 a 10 con su palabra, consejo y ejemplo) y un resumen. La
 * segunda simulación sale de una carrera y un nivel; la tercera del día se frena. Otra persona no ve la
 * simulación (404). Sin respuesta o con una muy corta no se llama al modelo. axe y 360 px. Datos
 * inventados; se borran al final (la baja de la cuenta de prueba arrastra las tablas por cascada).
 */
const TAG = `153-${Date.now()}`;
const GOOD_ANSWER =
  "Cuando el cierre mensual tardaba dos días en mi proyecto, armé un tablero con SQL y logré bajarlo a una hora, un 80% menos.";

test.use({ viewport: { width: 360, height: 800 } });
test.describe.configure({ mode: "serial" });

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "interview%")));
  } finally {
    await close();
  }
}

async function expectNoOverflowNorAxe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  const { scrollWidth, ancho } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    ancho: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(ancho);
}

let sessionUrl = "";

test.beforeAll(async () => {
  await seedSecondUserData(TAG);
  await clean();
});

test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

test("practicar con una oferta: cinco preguntas, una devolución por respuesta y el resumen", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await expect(page.getByRole("heading", { name: "Interview", level: 1 })).toBeVisible();
  await expect(page.getByText("Te quedan 2 simulaciones")).toBeVisible();
  await expectNoOverflowNorAxe(page);

  // La oferta de B es la primera opción
  await expect(page.getByLabel("Oferta", { exact: true })).toContainText(
    `Oferta Ficticia B ${TAG}`,
  );
  await page.getByTestId("interview-start-button").click();
  await page.waitForURL(/\/interview\/[0-9a-f-]{36}$/);
  sessionUrl = new URL(page.url()).pathname;

  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 1 de 5");
  await expect(page.getByTestId("interview-question")).toContainText(`Oferta Ficticia B ${TAG}`);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expectNoOverflowNorAxe(page);

  // Sin texto y con una respuesta muy corta: error claro, sin llamar al modelo
  await page.getByTestId("interview-send").click();
  await expect(page.getByTestId("interview-answer-error")).toContainText("Escribí tu respuesta");
  await page.getByTestId("interview-answer").fill("no sé");
  await page.getByTestId("interview-send").click();
  await expect(page.getByTestId("interview-answer-error")).toContainText("Contanos un poco más");

  for (let n = 1; n <= 5; n++) {
    await expect(page.getByTestId("interview-progress-label")).toHaveText(`Pregunta ${n} de 5`);
    await page.getByTestId("interview-answer").fill(GOOD_ANSWER);
    await page.getByTestId("interview-send").click();

    const feedback = page.getByTestId("interview-feedback");
    await expect(feedback).toBeVisible();
    for (const criterio of ["Claridad", "Relevancia", "Estructura STAR"]) {
      await expect(feedback.getByText(criterio, { exact: true })).toBeVisible();
    }
    await expect(feedback.getByText(/de 10 · /)).toHaveCount(3);
    await expect(page.getByTestId("interview-tip")).not.toBeEmpty();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(n));
    if (n === 1) await expectNoOverflowNorAxe(page);
    await page.getByTestId("interview-next").click();
  }

  const summary = page.getByTestId("interview-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Simulación terminada")).toBeVisible();
  await expect(summary.getByText(/de 10\. Es una guía para practicar/)).toBeVisible();
  await expect(summary.getByRole("listitem")).toHaveCount(5);
  await expectNoOverflowNorAxe(page);

  // Quedó guardado: cinco respuestas con puntajes de 0 a 10 y la simulación terminada
  const { db, close } = ownerDb();
  try {
    const answers = await db
      .select()
      .from(s.interviewAnswers)
      .where(eq(s.interviewAnswers.userId, E2E_B_USER_ID));
    expect(answers).toHaveLength(5);
    for (const a of answers) {
      for (const v of [a.clarity, a.relevance, a.star]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(10);
      }
      expect(a.model).toBe("fake");
    }
    const [session] = await db
      .select()
      .from(s.interviewSessions)
      .where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    expect(session?.status).toBe("terminada");
    // Las reservas de gasto se soltaron
    const reserves = await db
      .select({ id: s.llmCalls.id })
      .from(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), eq(s.llmCalls.task, "llm_reserve")));
    expect(reserves).toHaveLength(0);
  } finally {
    await close();
  }
});

test("el historial muestra la simulación terminada y se puede repasar", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await expect(page.getByText("Te queda 1 simulación")).toBeVisible();
  const history = page.getByTestId("interview-history");
  await expect(history).toContainText("Terminada");
  await history.getByRole("link", { name: "Ver resumen" }).click();
  await expect(page.getByTestId("interview-summary")).toBeVisible();
});

test("la segunda simulación sale de una carrera y un nivel; la tercera del día se frena", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await page.getByLabel("Una carrera y un nivel", { exact: true }).check();
  await page.getByLabel("Carrera o puesto", { exact: true }).fill("Analista de datos");
  await page.getByLabel("Nivel", { exact: true }).selectOption("semi_senior");
  await page.getByTestId("interview-start-button").click();
  await page.waitForURL(/\/interview\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 1 de 5");
  await expect(page.getByTestId("interview-question")).toContainText("Analista de datos");

  await page.goto("/interview");
  await expect(page.getByText("Hoy no te quedan simulaciones.")).toBeVisible();
  await expect(page.getByTestId("interview-start-button")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("interview-history")).toContainText("En curso: 0 de 5 respondidas");
  await expectNoOverflowNorAxe(page);

  // El tope lo respalda el servidor (test de integración de adapters/interview); acá, que quedaron dos
  const { db, close } = ownerDb();
  try {
    const sessions = await db
      .select({ id: s.interviewSessions.id })
      .from(s.interviewSessions)
      .where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    expect(sessions).toHaveLength(2);
  } finally {
    await close();
  }
});

async function openInProgress(page: Page): Promise<void> {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await page
    .getByTestId("interview-history")
    .getByRole("link", { name: "Seguir practicando" })
    .click();
  await expect(page.getByTestId("interview-answer")).toBeVisible();
}

test("sin dictado en el navegador no hay micrófono y se puede responder escribiendo", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "SpeechRecognition");
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
  });
  await openInProgress(page);
  await expect(page.getByTestId("dictar")).toHaveCount(0);
  await page.getByTestId("interview-answer").fill(GOOD_ANSWER);
  await expect(page.getByTestId("interview-send")).toBeVisible();
});

test("con dictado en el navegador aparece el micrófono con su aviso de privacidad", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      start(): void {}
      stop(): void {}
      abort(): void {}
    }
    Object.defineProperty(window, "SpeechRecognition", {
      value: FakeRecognition,
      configurable: true,
    });
  });
  await openInProgress(page);
  await expect(page.getByTestId("dictar-boton")).toBeVisible();
  await expect(page.getByTestId("dictar")).toContainText("no lo grabamos");
  await expectNoOverflowNorAxe(page);
});

test("otra persona no ve la simulación: 404", async ({ page }) => {
  expect(sessionUrl).toMatch(/^\/interview\//);
  await login(page);
  const res = await page.goto(sessionUrl);
  expect(res?.status()).toBe(404);
});
