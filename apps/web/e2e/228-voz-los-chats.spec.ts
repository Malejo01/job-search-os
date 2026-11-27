import * as s from "@job-search-os/db/schema";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import { E2E_B_USER_ID, loginAsSecondUser, ownerDb, removeSecondUser } from "./helpers";
import { FAKE_MIC, cleanB, installRecognition, openInterview, prepareB } from "./voz-helpers";

/**
 * Flujo 228 (R25-06): la voz en los chats. En cada pantalla (Interview, coach de CV, «Armá tu CV con IA» y huecos
 * del perfil) el reconocimiento simulado deja el texto en la vista previa y, al tocar «Listo», lo SUMA a lo que ya
 * había en el campo. La respuesta no se envía sola. El campo «Qué hacías» de la revisión (una tarea por línea)
 * no se prueba acá: llegar a la revisión exige una charla entera.
 */
test.use(FAKE_MIC);
test.describe.configure({ mode: "serial" });

const SAID = "Trabajé con datos de ventas";
const CV_TEXT = [
  "Persona Ficticia",
  "Analista de datos en Empresa A, desde marzo de 2021 hasta hoy.",
  "Armé tableros de ventas en Excel y SQL para el equipo comercial.",
  "Asistente administrativa en Empresa B, de 2019 a 2021.",
  "Ordené la facturación y el archivo de proveedores.",
  "Estudios: Tecnicatura en Administración, Instituto Ficticio, 2018.",
].join("\n");

let sessionId = "";

async function cleanHistory(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    // R33-02: el borrador automático del chat y del coach también se borra
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    await db
      .delete(s.careerHistory)
      .where(
        and(
          eq(s.careerHistory.userId, E2E_B_USER_ID),
          like(s.careerHistory.organization, "Empresa % (228)"),
        ),
      );
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 228");
  await cleanHistory();
  const { db, close } = ownerDb();
  try {
    await db.insert(s.careerHistory).values({
      userId: E2E_B_USER_ID,
      kind: "trabajo",
      organization: "Empresa A (228)",
      title: "Analista de datos",
      startMonth: "2021-03",
      endMonth: null,
      bullets: ["Armé tableros de ventas en Excel"],
      source: "cv",
      sort: 0,
    });
  } finally {
    await close();
  }
});
test.afterAll(async () => {
  await cleanHistory();
  await cleanB();
  await removeSecondUser();
});

/** Dicta con el reconocimiento simulado y comprueba que se suma al texto previo y no se envía. */
async function dictateInto(page: Page, field: Locator): Promise<void> {
  await field.fill("Antes de hablar");
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-vista-previa")).toContainText("Trabajé con datos");
  await expect(field).toHaveValue("Antes de hablar");
  await page.evaluate(() => (window as unknown as { __recFinal: () => void }).__recFinal());
  await page.getByTestId("voice-listo").click();
  await expect(field).toHaveValue(`Antes de hablar ${SAID}`);
}

test("Interview", async ({ page }) => {
  await installRecognition(page, "live");
  await openInterview(page, sessionId);
  await dictateInto(page, page.getByTestId("interview-answer"));
  await expect(page.getByTestId("interview-feedback")).toHaveCount(0);
});

test("coach de CV", async ({ page }) => {
  test.setTimeout(120_000);
  await installRecognition(page, "live");
  await loginAsSecondUser(page);
  await page.goto("/cv/coach");
  const read = await page.evaluate(async (text) => {
    const res = await fetch("/api/cv-perfil/leer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return (await res.json()) as { ticket?: string };
  }, CV_TEXT);
  await page.evaluate((t) => window.sessionStorage.setItem("jso:pa:ticket", t), read.ticket ?? "");
  await page.goto("/cv/coach");
  await page.getByTestId("coach-review").click();
  await expect(page.getByTestId("coach-issues")).toBeVisible();
  await page.getByTestId("coach-start-chat").click();
  await page.waitForURL(/\/cv\/coach\/charla/);
  await expect(page.getByTestId("coach-answer")).toBeVisible();
  await dictateInto(page, page.getByTestId("coach-answer"));
  // No se mandó ninguna respuesta
  await expect(page.getByTestId("coach-line-me")).toHaveCount(0);
});

test("Armá tu CV con IA", async ({ page }) => {
  await installRecognition(page, "live");
  await loginAsSecondUser(page);
  await page.goto("/cv/armar");
  await page.getByRole("button", { name: "Empezar" }).click();
  const campo = page.locator("#cv-answer");
  await expect(campo).toBeVisible();
  await dictateInto(page, campo);
  await expect(page.getByTestId("cv-messages").getByText(SAID)).toHaveCount(0);
});

test("huecos del perfil", async ({ page }) => {
  await installRecognition(page, "live");
  await loginAsSecondUser(page);
  await page.goto("/cv/perfil/huecos");
  const question = page.getByTestId("gaps-question");
  const done = page.getByTestId("gaps-done");
  await expect(question.or(done)).toBeVisible({ timeout: 20_000 });
  // Si la primera pregunta es de nivel de skill (botones) o no queda nada, no hay campo de texto
  test.skip(
    (await page.locator("#gaps-answer").count()) === 0,
    "la primera pregunta de huecos no es de texto con los datos de este flujo",
  );
  await dictateInto(page, page.locator("#gaps-answer"));
  await expect(page.getByTestId("gaps-card")).toHaveCount(0);
});
