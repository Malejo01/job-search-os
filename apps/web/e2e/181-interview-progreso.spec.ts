import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 181 (R23-02): progreso en el tiempo y borrado en Interview. Crea su propia persona de prueba (B) con tres
 * simulaciones terminadas de puntajes crecientes y una a medias. Comprueba la tabla de evolución, retomar la que
 * está a medias y borrar una con confirmación en la página (sin `window.confirm`): Escape cancela y devuelve el
 * foco, «Sí, borrar» la quita con sus respuestas. Sin modelo ni gasto. Datos inventados; se borran al final.
 */
const TAG = `181-${Date.now()}`;
const TITLES = ["Simulación ficticia uno", "Simulación ficticia dos", "Simulación ficticia tres"];
const IN_PROGRESS = "Simulación ficticia a medias";

test.describe.configure({ mode: "serial" });

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

async function seedSession(
  title: string,
  status: "terminada" | "en_curso",
  score: number,
  daysAgo: number,
  answers: number,
): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [session] = await db
      .insert(s.interviewSessions)
      .values({
        userId: E2E_B_USER_ID,
        sourceKind: "career",
        career: "Analista de datos",
        seniority: "junior",
        title,
        questions: [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de la simulación`),
        status,
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
        finishedAt: status === "terminada" ? new Date() : null,
      })
      .returning({ id: s.interviewSessions.id });
    if (answers > 0) {
      await db.insert(s.interviewAnswers).values(
        Array.from({ length: answers }, (_, position) => ({
          sessionId: session!.id,
          userId: E2E_B_USER_ID,
          position,
          answer: `Respuesta ficticia ${position + 1} con una situación, una acción y un resultado.`,
          clarity: score,
          relevance: score,
          star: score,
          tip: "Consejo ficticio",
          example: "Ejemplo ficticio",
          model: "fake",
        })),
      );
    }
    return session!.id;
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
  await seedSecondUserData(TAG);
  await clean();
  await seedSession(TITLES[0]!, "terminada", 4, 3, 5);
  await seedSession(TITLES[1]!, "terminada", 6, 2, 5);
  await seedSession(TITLES[2]!, "terminada", 8, 1, 5);
  await seedSession(IN_PROGRESS, "en_curso", 5, 0, 2);
});

test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

test("la tabla muestra la evolución de los tres puntajes y lo que cambió", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  const progress = page.getByTestId("interview-progress");
  await expect(progress).toBeVisible();
  // Tres simulaciones terminadas; la que está a medias no cuenta
  await expect(progress.getByRole("row")).toHaveCount(4);
  await expect(progress.getByRole("columnheader", { name: "Claridad" })).toBeVisible();
  await expect(progress.getByRole("columnheader", { name: "Estructura STAR" })).toBeVisible();
  await expect(page.getByTestId("interview-progress-change")).toContainText(
    "claridad subió 4, relevancia subió 4, estructura star subió 4",
  );
  await expectNoSeriousAxe(page);
});

test("se retoma una simulación a medias", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  await page
    .getByTestId("interview-history")
    .getByRole("listitem")
    .filter({ hasText: IN_PROGRESS })
    .getByRole("link", { name: "Seguir practicando" })
    .click();
  await page.waitForURL(/\/interview\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 3 de 5");
});

test("borrar pide confirmación en la página: Escape cancela, «Sí, borrar» la quita con sus respuestas", async ({
  page,
}) => {
  page.on("dialog", (d) => {
    throw new Error(`no debía abrirse un diálogo del navegador: ${d.message()}`);
  });
  await loginAsSecondUser(page);
  await page.goto("/interview");
  const card = page.getByTestId("interview-history").getByRole("listitem").filter({
    hasText: TITLES[0]!,
  });

  await card.getByTestId("interview-delete").click();
  const confirm = card.getByTestId("interview-delete-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("¿Borrar esta simulación?");
  // El foco pasa a la opción segura
  await expect(card.getByTestId("interview-delete-cancel")).toBeFocused();
  await expectNoSeriousAxe(page);

  // Escape cancela y devuelve el foco al botón
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(card.getByTestId("interview-delete")).toBeFocused();

  // Confirmar la borra
  await card.getByTestId("interview-delete").click();
  await card.getByTestId("interview-delete-yes").click();
  await expect(
    page.getByTestId("interview-history").getByText(TITLES[0]!, { exact: true }),
  ).toHaveCount(0);

  const { db, close } = ownerDb();
  try {
    const sessions = await db
      .select({ title: s.interviewSessions.title })
      .from(s.interviewSessions)
      .where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    expect(sessions.map((x) => x.title)).not.toContain(TITLES[0]);
    expect(sessions).toHaveLength(3);
    const answers = await db
      .select({ id: s.interviewAnswers.id })
      .from(s.interviewAnswers)
      .where(eq(s.interviewAnswers.userId, E2E_B_USER_ID));
    // Quedan las respuestas de las otras tres: 5 + 5 + 2
    expect(answers).toHaveLength(12);
  } finally {
    await close();
  }
});
