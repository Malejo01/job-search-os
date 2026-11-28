import { expect, test } from "@playwright/test";
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
 * Flujo 187 (R23-06): microinteracciones. El detalle del sello crece al abrirse y sus barras se
 * llenan; con «reducir movimiento» queda todo en su estado final sin pasar por altura 0. La voz
 * muestra «Escuchando…» con la voz simulada, en la pregunta de una simulación de Interview. Con la persona B
 * (ficticia, con una oferta evaluada de 8): corre en local y en el CI. Datos inventados; se borran al final.
 */
// R25-05: `VoiceInput` pide el micrófono antes de dictar; Chromium lo da falso y sin cartel
// (a nivel de archivo: `launchOptions` dentro de un `describe` fuerza otro worker y Playwright lo rechaza)
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});

test.describe("Flujo 187: microinteracciones", () => {
  const tag = `187-${Date.now()}`;
  let jobId = "";
  let sessionId = "";

  test.beforeAll(async () => {
    jobId = (await seedSecondUserData(tag)).jobId;
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.interviewSessions)
        .values({
          userId: E2E_B_USER_ID,
          sourceKind: "career",
          career: "Analista de datos",
          seniority: "junior",
          title: "Simulación ficticia de microinteracciones",
          questions: [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de la simulación`),
        })
        .returning({ id: s.interviewSessions.id });
      sessionId = row!.id;
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    } finally {
      await close();
    }
    await removeSecondUser();
  });

  test("el detalle se abre y las barras terminan en su ancho final", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    const detail = page.getByTestId("afinidad-detalle");
    await expect(detail).toBeVisible();
    await detail.getByText("Cómo calculamos la afinidad").click();
    await expect(detail).toHaveAttribute("open", "");
    const meter = detail.getByRole("meter").first();
    await expect(meter).toBeVisible();
    // Al terminar la transición el relleno mide lo que dice el medidor
    const now = Number(await meter.getAttribute("aria-valuenow"));
    await expect
      .poll(async () =>
        meter.evaluate((el) => {
          const fill = el.firstElementChild as HTMLElement;
          return Math.round(
            (fill.getBoundingClientRect().width / el.getBoundingClientRect().width) * 10,
          );
        }),
      )
      .toBe(Math.round(now));
    // R24-04b: la transición es WAAPI y no deja estilo inline. El panel termina sin animaciones en
    // curso, con alto real y opaco, y sin altura fija en línea
    const panel = detail.locator("div.overflow-hidden").first();
    await expect.poll(() => panel.evaluate((el) => el.getAnimations().length)).toBe(0);
    expect(await panel.evaluate((el) => el.style.height)).toBe("");
    expect(await panel.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
    expect(await panel.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("con «reducir movimiento» el detalle abre ya en su estado final", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await loginAsSecondUser(page);
      await page.goto(`/jobs/${jobId}`);
      const detail = page.getByTestId("afinidad-detalle");
      await detail.getByText("Cómo calculamos la afinidad").click();
      const panel = detail.locator("div.overflow-hidden").first();
      // Sin pasar por altura 0: ninguna animación en curso, con alto real y opaco desde el primer instante
      expect(await panel.evaluate((el) => el.getAnimations().length)).toBe(0);
      expect(await panel.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
      expect(await panel.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    } finally {
      await context.close();
    }
  });

  test("Dictar muestra «Escuchando…» mientras se dicta", async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition {
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => this.onstart?.(), 0);
        }
        stop() {
          setTimeout(() => this.onend?.(), 0);
        }
        abort() {
          this.stop();
        }
      }
      Object.assign(window, {
        SpeechRecognition: FakeRecognition,
        webkitSpeechRecognition: FakeRecognition,
      });
    });
    await loginAsSecondUser(page);
    await page.goto(`/interview/${sessionId}`);
    const boton = page.getByTestId("voice-boton");
    await expect(boton).toBeVisible();
    await boton.click();
    await expect(page.getByTestId("voice-escuchando")).toContainText("Escuchando");
    await page.getByTestId("voice-listo").click();
    await expect(page.getByTestId("voice-escuchando")).toHaveCount(0);
  });
});
