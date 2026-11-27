import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 152 (R17-09, R25-05): el botón de voz del chat del coach de CV.
 * - sin `SpeechRecognition` ni `webkitSpeechRecognition`, graba (con el servidor en `testers`) o muestra un
 *   mensaje en lugar del botón, y el campo sigue andando;
 * - con un reconocimiento simulado, el texto en vivo queda en la vista previa y cae en el campo al tocar «Listo».
 * Se llega al chat con el ticket de la lectura del agente de perfil (modelo de demo, sin gasto), como en el 147.
 */
test.describe.configure({ mode: "serial" });

// R25-05: `VoiceInput` pide el micrófono antes de dictar; Chromium lo da falso y sin cartel
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});
const SERVER_MODE_ON = process.env.E2E_VOICE_SERVER_MODE === "testers";

const CV_TEXT = [
  "Persona Ficticia",
  "Analista de datos en Empresa A, desde marzo de 2021 hasta hoy.",
  "Armé tableros de ventas en Excel y SQL para el equipo comercial.",
  "Asistente administrativa en Empresa B, de 2019 a 2021.",
  "Ordené la facturación y el archivo de proveedores.",
  "Estudios: Tecnicatura en Administración, Instituto Ficticio, 2018.",
].join("\n"); // La lectura pide al menos 300 caracteres (S4)

async function cleanup(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    // R33-02: el borrador automático del chat y del coach también se borra
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    await db
      .delete(s.careerHistory)
      .where(
        and(
          eq(s.careerHistory.userId, E2E_B_USER_ID),
          like(s.careerHistory.organization, "Empresa % (152)"),
        ),
      );
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

async function openChat(page: Page) {
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
}

test.describe("Flujo 152: dictar", () => {
  test.beforeAll(async () => {
    await cleanup();
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      await db.insert(s.careerHistory).values({
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa A (152)",
        title: "Analista de datos",
        startMonth: "2021-03",
        endMonth: null,
        bullets: ["Armé tableros de ventas en Excel", "Responsable de reportes"],
        source: "cv",
        sort: 0,
      });
    } finally {
      await close();
    }
  });
  test.afterAll(async () => {
    await cleanup();
    await removeSecondUser();
  });

  test("sin soporte del navegador no hay dictado en vivo y el campo sigue andando", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        value: undefined,
        configurable: true,
      });
    });
    await openChat(page);
    // Sin dictado propio el navegador graba; si el servidor no transcribe, un mensaje en lugar del botón
    if (SERVER_MODE_ON) {
      await expect(page.getByTestId("voice-boton")).toBeVisible();
    } else {
      await expect(page.getByTestId("voice-boton")).toHaveCount(0);
      await expect(page.getByTestId("voice-no-disponible")).toBeVisible();
    }
    // El campo de texto sigue andando
    await page.getByTestId("coach-answer").fill("Respuesta escrita a mano");
    await expect(page.getByTestId("coach-send")).toBeEnabled();
  });

  test("con soporte aparece y el texto dictado cae en el campo", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      class Fake {
        lang = "";
        continuous = false;
        interimResults = false;
        onresult: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        start() {
          (window as unknown as { __lang: string }).__lang = this.lang;
          const r = [
            Object.assign([{ transcript: "Cerraba las ventas antes" }], { isFinal: true }),
          ];
          setTimeout(
            () => this.onresult?.({ results: Object.assign(r, { length: r.length }) }),
            50,
          );
        }
        stop() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, "SpeechRecognition", { value: Fake, configurable: true });
    });
    await openChat(page);
    const button = page.getByTestId("voice-boton");
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("voice-input")).toContainText(
      /el navegador puede mandar el audio/i,
    );
    await page.getByTestId("coach-answer").fill("Con los tableros");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    // El texto en vivo queda en la vista previa; recién al tocar «Listo» cae en el campo
    await expect(page.getByTestId("voice-vista-previa")).toContainText("Cerraba las ventas antes");
    await expect(page.getByTestId("coach-answer")).toHaveValue("Con los tableros");
    expect(await page.evaluate(() => (window as unknown as { __lang: string }).__lang)).toBe(
      "es-AR",
    );
    await page.getByTestId("voice-listo").click();
    await expect(page.getByTestId("coach-answer")).toHaveValue(
      "Con los tableros Cerraba las ventas antes",
    );
    await expect(button).toHaveAttribute("aria-pressed", "false");
    // Nunca se envía solo: la charla no recibió la respuesta
    await expect(page.getByTestId("coach-line-me")).toHaveCount(0);
  });
});
