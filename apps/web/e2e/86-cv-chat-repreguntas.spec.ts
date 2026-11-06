import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 86b (R4-16): repreguntas en el chat «Armá tu CV con IA». Con LLM_DEMO (fake guionado, sin red ni
 * gasto) y la persona B (`CV_CHAT_ENABLED=all`, no hace falta ser admin): si las fechas quedan incompletas
 * el chat repregunta sobre el mismo tema (texto del modelo, validado por el código); con «no me acuerdo» se acepta y
 * pasa al tema siguiente. Datos inventados; se borran al final.
 */
test.use({ viewport: { width: 360, height: 800 } });
test.describe.configure({ mode: "serial" });

async function clean() {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

test.beforeAll(clean);
test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

const lastMessage = async (page: Page): Promise<string> =>
  (await page.getByTestId("cv-messages").locator("p").last().innerText()).trim();

test("fechas incompletas: repregunta una vez y «no me acuerdo» la corta", async ({ page }) => {
  await ensureSecondUser();
  await loginAsSecondUser(page);
  await page.goto("/cv/armar");
  await page.getByRole("button", { name: "Empezar" }).click();
  const answer = page.getByLabel("Tu respuesta");
  await expect(answer).toBeFocused();

  const send = async (text: string, siguiente: RegExp | string) => {
    await answer.fill(text);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect
      .poll(() => lastMessage(page))
      .toMatch(typeof siguiente === "string" ? new RegExp(siguiente) : siguiente);
  };

  await send("Analista de datos", /empresa/i);
  await send("Empresa Ficticia Repreguntas", /qué cargo/i);
  await send("Analista Junior", /desde cuándo/i);

  // Solo dijo el inicio: el sistema repregunta sobre las fechas (texto fijo del fake)
  await send("Desde 2020", /contarme un poco más sobre eso/);
  await expect(page.getByTestId("cv-progress")).toContainText("Avance:");

  // «No me acuerdo» se acepta y se sigue con el tema siguiente
  await send("No me acuerdo", /qué hacías/i);
});
