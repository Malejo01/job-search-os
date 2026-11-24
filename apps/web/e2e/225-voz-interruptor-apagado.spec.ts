import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { ownerDb } from "./helpers";
import {
  FAKE_MIC,
  OFF_USER,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  ensureOffUser,
  installRecognition,
  loginAsOffUser,
  removeOffUser,
} from "./voz-helpers";

/**
 * Flujo 225 (R25-06): el interruptor `VOICE_SERVER_TRANSCRIBE` apagado para una persona (el servidor de e2e está en
 * `testers` y esta persona inventada no es tester). Un navegador que necesita grabar (Opera GX) ve un mensaje claro
 * en lugar del botón y puede escribir; la ruta le responde 403 `off`. Un navegador con dictado propio (Chrome)
 * sigue andando. Sin sesión, la ruta responde 401.
 */
test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
test.use(FAKE_MIC);
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await ensureOffUser();
});
test.afterAll(async () => {
  await removeOffUser();
});

test.describe("Opera GX", () => {
  test.use({ userAgent: OPERA_GX_UA });

  test("sin interruptor no hay botón, hay un mensaje, y la ruta dice que no", async ({ page }) => {
    await loginAsOffUser(page);
    await page.goto(`/interview/${sessionId}`);
    await expect(page.getByTestId("voice-input")).toBeVisible();
    await expect(page.getByTestId("voice-boton")).toHaveCount(0);
    await expect(page.getByTestId("voice-no-disponible")).toContainText("Chrome, Edge o Safari");
    // El campo sigue andando
    await page.getByTestId("interview-answer").fill("Respuesta escrita a mano");
    await expect(page.getByTestId("interview-send")).toBeEnabled();

    const res = await page.evaluate(async () => {
      const form = new FormData();
      form.append("audio", new Blob([new Uint8Array(64)], { type: "audio/webm" }), "voz.webm");
      form.append("durationMs", "1000");
      const r = await fetch("/api/transcribe", { method: "POST", body: form });
      return { status: r.status, body: (await r.json()) as { error?: string } };
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("off");
  });
});

test("Chrome con dictado propio sigue andando con el interruptor apagado", async ({ page }) => {
  await installRecognition(page, "live");
  await loginAsOffUser(page);
  await page.goto(`/interview/${sessionId}`);
  await expect(page.getByTestId("voice-boton")).toBeVisible();
  await expect(page.getByTestId("voice-no-disponible")).toHaveCount(0);
});

// El middleware manda todo `/api/*` sin sesión a /login (el 401 propio de la ruta está en su unitario)
test("sin sesión la ruta no se ejecuta: redirige a /login", async ({ request }) => {
  const res = await request.post("/api/transcribe", {
    maxRedirects: 0,
    multipart: {
      audio: { name: "voz.webm", mimeType: "audio/webm", buffer: Buffer.from("fake") },
      durationMs: "1000",
    },
  });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toContain("/login");
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({ id: s.llmCalls.id })
      .from(s.llmCalls)
      .where(and(eq(s.llmCalls.task, "transcribe_audio"), eq(s.llmCalls.userId, OFF_USER.id)));
    expect(rows).toHaveLength(0);
  } finally {
    await close();
  }
});
