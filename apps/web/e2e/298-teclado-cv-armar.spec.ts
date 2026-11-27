import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";
import { reach } from "./teclado-helpers";

/**
 * Flujo 298 (R28-08): el chat «Armá tu CV con IA» solo con teclado. Tab hasta «Empezar», Enter, el foco cae en
 * el campo de respuesta, se escribe, Tab hasta «Enviar» y Enter. La charla es un `role="log"` con
 * `aria-live="polite"`: la respuesta nueva se anuncia sola, y el foco vuelve al campo cuando termina de
 * pensar. Persona B (ficticia), con el modelo simulado.
 */
test.use({ viewport: { width: 1280, height: 800 } });
test.setTimeout(90_000);

test.beforeAll(ensureSecondUser);
test.afterAll(async () => {
  // R33-02: el borrador automático del chat se borra
  const { db, close } = ownerDb();
  try {
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
  await removeSecondUser().catch(() => {});
});

test("empezar, responder y recibir la pregunta siguiente, con foco y anuncio", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/cv/armar");
  const empezar = page.getByRole("button", { name: "Empezar" });
  await reach(page, empezar, "Empezar");
  await page.keyboard.press("Enter");

  const campo = page.getByLabel("Tu respuesta");
  await expect(campo, "al empezar, el foco va al campo").toBeFocused();
  const mensajes = page.getByTestId("cv-messages");
  await expect(mensajes).toHaveAttribute("role", "log");
  await expect(mensajes).toHaveAttribute("aria-live", "polite");
  const antes = await mensajes.locator("p").count();

  await page.keyboard.insertText("Analista de datos");
  const enviar = page.getByRole("button", { name: "Responder y seguir", exact: true });
  await reach(page, enviar, "Responder y seguir");
  await page.keyboard.press("Enter");

  // La respuesta llega a la región en vivo y el foco vuelve al campo (se deshabilita mientras piensa)
  await expect
    .poll(async () => mensajes.locator("p").count(), { timeout: 30_000 })
    .toBeGreaterThan(antes + 1);
  await expect(campo, "al terminar de pensar, el foco vuelve al campo").toBeFocused({
    timeout: 10_000,
  });
});
