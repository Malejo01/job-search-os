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
 * Flujo 182 (R23-08): Interview pulido. Persona de prueba propia (B), modelo simulado (`LLM_DEMO=1`, sin red ni
 * gasto). Comprueba: el vacío con marca y una salida, el 404 propio con «Ir a Interview», el skeleton al enviar
 * una respuesta (también con movimiento reducido) y el aviso del tope diario con cuándo vuelve el cupo.
 * Datos inventados; se borran al final.
 */
const TAG = `182-${Date.now()}`;
const GOOD_ANSWER =
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

async function seedSession(title: string): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .insert(s.interviewSessions)
      .values({
        userId: E2E_B_USER_ID,
        sourceKind: "career",
        career: "Analista de datos",
        seniority: "junior",
        title,
        questions: [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de la simulación`),
      })
      .returning({ id: s.interviewSessions.id });
    return row!.id;
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

/** Demora las Server Actions (POST a la propia página) para poder ver el skeleton. */
async function slowActions(page: Page, ms: number): Promise<void> {
  await page.route(/\/interview\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

let sessionPath = "";

test.beforeAll(async () => {
  await seedSecondUserData(TAG);
  await clean();
});

test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

test("sin simulaciones: vacío con marca y una salida hacia el formulario", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/interview");
  const vacio = page.getByTestId("interview-vacio");
  await expect(vacio).toBeVisible();
  await expect(vacio).toContainText("Todavía no hiciste ninguna simulación");
  await vacio.getByRole("link", { name: "Empezar mi primera simulación" }).click();
  await expect(page).toHaveURL(/#interview-empezar$/);
  await expectNoSeriousAxe(page);
});

test("una simulación que no existe da un 404 propio con salida a Interview", async ({ page }) => {
  await loginAsSecondUser(page);
  const res = await page.goto("/interview/00000000-0000-4000-8000-000000000000");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No encontramos esta simulación" })).toBeVisible();
  await expectNoSeriousAxe(page);
  await page.getByRole("link", { name: "Ir a Interview" }).click();
  await expect(page).toHaveURL(/\/interview$/);
});

test("al enviar una respuesta aparece el skeleton y después la devolución", async ({ page }) => {
  sessionPath = `/interview/${await seedSession("Simulación ficticia uno")}`;
  await loginAsSecondUser(page);
  await slowActions(page, 1500);
  await page.goto(sessionPath);
  await page.getByTestId("interview-answer").fill(GOOD_ANSWER);
  await page.getByTestId("interview-send").click();
  const skeleton = page.getByTestId("interview-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveAttribute("aria-busy", "true");
  await expect(skeleton).toContainText("Analizando tu respuesta…");
  await expect(page.getByTestId("interview-feedback")).toBeVisible({ timeout: 20_000 });
  await expect(skeleton).toBeHidden();
});

test("con movimiento reducido el skeleton sigue estando, sin animación", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginAsSecondUser(page);
  await slowActions(page, 1500);
  await page.goto(sessionPath);
  // La primera respuesta ya está guardada: toca la segunda pregunta
  await expect(page.getByTestId("interview-progress-label")).toHaveText("Pregunta 2 de 5");
  await page.getByTestId("interview-answer").fill(GOOD_ANSWER);
  await page.getByTestId("interview-send").click();
  const skeleton = page.getByTestId("interview-skeleton");
  await expect(skeleton).toBeVisible();
  const opacities = await skeleton
    .locator("span")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
  expect(opacities.every((o) => o === "1")).toBe(true);
  await expect(page.getByTestId("interview-feedback")).toBeVisible({ timeout: 20_000 });
});

test("sin cupo, el aviso dice cuándo vuelve a habilitarse", async ({ page }) => {
  await seedSession("Simulación ficticia dos");
  await loginAsSecondUser(page);
  await page.goto("/interview");
  const aviso = page.getByTestId("interview-daily-limit");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Vas a poder empezar otra el");
  await expect(aviso.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await expectNoSeriousAxe(page);
});
