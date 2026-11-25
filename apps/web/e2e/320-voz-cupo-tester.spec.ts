import { expect, test, type Page } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { and, eq } from "drizzle-orm";
import { E2E_B_USER_ID, ownerDb, removeSecondUser } from "./helpers";
import {
  FAKE_MIC,
  FAKE_TRANSCRIPTION_SHORT,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  cleanB,
  openInterview,
  prepareB,
} from "./voz-helpers";

/**
 * Flujo 320 (R29-06): el cupo diario de voz de las testers es de 60 minutos (el resto, 20). La persona B (inventada)
 * es tester en el servidor de e2e. Con el transcriptor simulado y el UA de Opera GX (camino «grabación + servidor»,
 * el único que tiene cupo: en Chrome, Edge y Safari el dictado es del navegador):
 * - con 20 minutos ya usados todavía puede dictar (un no-tester ya estaría en el tope);
 * - con los 60 usados, el servidor responde 429, la pantalla avisa y lo escrito no se pierde.
 */
test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
test.use({ ...FAKE_MIC, userAgent: OPERA_GX_UA });
test.describe.configure({ mode: "serial" });

async function seedUsedSeconds(seconds: number, id: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.llmCalls).values({
      userId: E2E_B_USER_ID,
      task: "transcribe_audio",
      model: "fake",
      promptVersion: "transcribe_audio@v1",
      label: `voice:${seconds}:${id}`,
      costUsd: 0,
      latencyMs: 0,
      ok: true,
      createdAt: new Date(),
    });
  } finally {
    await close();
  }
}

/** Borra solo las llamadas de voz de B (la simulación sigue). */
async function clearVoiceCalls(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), eq(s.llmCalls.task, "transcribe_audio")));
  } finally {
    await close();
  }
}

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 320");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

async function dictar(page: Page) {
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-escuchando")).toBeVisible();
  await page.waitForTimeout(1_500);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/transcribe")),
    page.getByTestId("voice-listo").click(),
  ]);
  return response;
}

test("una tester con 20 minutos usados todavía puede dictar", async ({ page }) => {
  await seedUsedSeconds(1200, "tester20");
  await openInterview(page, sessionId);
  const campo = page.getByTestId("interview-answer");
  await campo.fill("Hola");
  const response = await dictar(page);
  expect(response.status()).toBe(200);
  await expect(campo).toHaveValue(`Hola ${FAKE_TRANSCRIPTION_SHORT}`);
});

test("con los 60 minutos usados muestra el tope y no pierde lo escrito", async ({ page }) => {
  await clearVoiceCalls();
  await seedUsedSeconds(3600, "tester60");
  await openInterview(page, sessionId);
  const campo = page.getByTestId("interview-answer");
  await campo.fill("Algo escrito");
  const response = await dictar(page);
  expect(response.status()).toBe(429);
  await expect(page.getByTestId("voice-error")).toContainText("tope");
  await expect(campo).toHaveValue("Algo escrito");
  await campo.fill("Algo escrito y seguí a mano");
  await expect(page.getByTestId("interview-send")).toBeEnabled();
});
