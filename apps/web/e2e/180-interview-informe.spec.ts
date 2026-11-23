import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 180 (R23-01): informe al terminar una simulación de Interview. Crea su propia persona de prueba (B),
 * deja sembrada una simulación terminada con cinco respuestas de puntajes conocidos y comprueba el informe:
 * promedios con su palabra, mejor y más floja, consejos agrupados por criterio, impresión limpia y «Practicar de
 * nuevo con esta oferta» (modelo simulado `LLM_DEMO=1`, sin red ni gasto). Datos inventados; se borran al final.
 */
const TAG = `180-${Date.now()}`;

test.describe.configure({ mode: "serial" });

const SCORES: [number, number, number][] = [
  [9, 9, 8], // la mejor: 8,7
  [3, 4, 2], // la más floja: 3
  [5, 8, 8], // lo más flojo: claridad
  [8, 4, 8], // lo más flojo: relevancia
  [8, 7, 3],
];

let sessionPath = "";

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

async function expectNoSeriousAxe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
}

test.beforeAll(async () => {
  const data = await seedSecondUserData(TAG);
  await clean();
  const { db, close } = ownerDb();
  try {
    const [session] = await db
      .insert(s.interviewSessions)
      .values({
        userId: E2E_B_USER_ID,
        sourceKind: "job",
        jobId: data.jobId,
        title: `${data.title} · ${data.company}`,
        questions: [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de la simulación`),
        status: "terminada",
        finishedAt: new Date(),
      })
      .returning({ id: s.interviewSessions.id });
    sessionPath = `/interview/${session!.id}`;
    await db.insert(s.interviewAnswers).values(
      SCORES.map(([clarity, relevance, star], position) => ({
        sessionId: session!.id,
        userId: E2E_B_USER_ID,
        position,
        answer: `Respuesta ficticia ${position + 1} con una situación, una acción y un resultado.`,
        clarity,
        relevance,
        star,
        tip: `Consejo ficticio de la pregunta ${position + 1}`,
        example: `Ejemplo ficticio de la pregunta ${position + 1}`,
        model: "fake",
      })),
    );
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

test("el informe muestra promedios, mejor y más floja, y consejos agrupados", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto(sessionPath);

  const report = page.getByTestId("interview-report");
  await expect(report).toBeVisible();

  // Promedios: claridad 6,6 (Bien), relevancia 6,4 (Bien), STAR 5,8 (Mejorable)
  const averages = page.getByTestId("interview-report-averages");
  await expect(averages).toContainText("Claridad");
  await expect(averages).toContainText("6,6");
  await expect(averages).toContainText("6,4");
  await expect(averages).toContainText("5,8");
  await expect(averages.getByText(/de 10 · /)).toHaveCount(3);
  await expect(averages).toContainText("Mejorable");

  await expect(page.getByTestId("interview-report-best")).toContainText("Pregunta 1 · 8,7 de 10");
  await expect(page.getByTestId("interview-report-worst")).toContainText("Pregunta 2 · 3 de 10");

  // Estructura STAR fue lo más flojo en tres respuestas: el primer grupo, con el consejo de la más floja (la 2)
  const tips = page.getByTestId("interview-report-tips");
  await expect(tips).toContainText("Estructura STAR · en 3 respuestas");
  await expect(tips).toContainText("Consejo ficticio de la pregunta 2");

  await expect(page.getByTestId("interview-retry")).toHaveText(
    "Practicar de nuevo con esta oferta",
  );
  // Lo que ya existía sigue: las cinco respuestas una por una
  await expect(page.getByTestId("interview-summary").getByRole("listitem")).toHaveCount(5);
  await expectNoSeriousAxe(page);
});

test("al imprimir sale solo el informe, sin botones ni navegación", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto(sessionPath);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("interview-report")).toBeVisible();
  await expect(page.getByTestId("interview-retry")).toBeHidden();
  await expect(page.getByRole("button", { name: "Imprimir o guardar como PDF" })).toBeHidden();
  await expect(page.locator("header").first()).toBeHidden();
});

test("practicar de nuevo con esta oferta empieza otra simulación con la misma oferta", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto(sessionPath);
  await page.getByTestId("interview-retry").click();
  // La URL actual ya calza con el patrón: hay que esperar a que cambie a otra simulación
  await page.waitForURL(
    (u) => u.pathname !== sessionPath && /^\/interview\/[0-9a-f-]{36}$/.test(u.pathname),
  );
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 1 de 5");
  await expect(page.getByTestId("interview-question")).toContainText(`Oferta Ficticia B ${TAG}`);
});
