import { expect, test } from "@playwright/test";
import {
  createInboundEmail,
  deleteInboundEmails,
  login,
  neutralizeAssistantFacts,
  restoreAssistantFacts,
  setSeedInboundAddress,
  type AssistantFactsBackup,
} from "./helpers";

const TAG = "E2E asistente en vivo";
const NEW_ADDRESS = "u_abcdefghijklmnopqrst@ingest.test";
const CONFIRM_LINK = "https://mail.google.com/mail/vf-ejemplo-123";

/**
 * Flujo 24: el asistente avanza solo según lo que llegó. El usuario de e2e tiene una dirección del
 * formato anterior: el test le pone una nueva y la restaura al final, junto con los emails que
 * cambian los hechos del asistente. Serial: comparten el estado de ese usuario.
 */
test.describe.serial("Flujo 24: asistente con el paso actual", () => {
  let previousAddress: string | null = null;
  let backup: AssistantFactsBackup = [];

  test.beforeAll(async () => {
    previousAddress = await setSeedInboundAddress(NEW_ADDRESS);
    backup = await neutralizeAssistantFacts();
  });

  test.afterAll(async () => {
    await deleteInboundEmails(TAG);
    await restoreAssistantFacts(backup);
    // La columna es NOT NULL: null solo si el usuario seed no tenía perfil, y entonces no hay nada que restaurar
    if (previousAddress) await setSeedInboundAddress(previousAddress);
  });

  test("sin nada hecho: paso 1 con el link a Gmail", async ({ page }) => {
    await login(page);
    await page.goto("/settings/asistente");
    const current = page.locator('[aria-current="step"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Agregá la dirección de reenvío");
    await expect(current.getByRole("link", { name: /Reenvío y correo POP\/IMAP/ })).toHaveAttribute(
      "href",
      /^https:\/\/mail\.google\.com\//,
    );
  });

  test("llega el pedido de Gmail: paso 2, «Ya lo confirmé» pasa al paso 3", async ({ page }) => {
    await createInboundEmail({
      subject: `${TAG} confirmación`,
      parser: "gmail_reenvio",
      error: null,
      text: `Confirmá el reenvío: ${CONFIRM_LINK}`,
    });
    await login(page);
    await page.goto("/settings/asistente");
    const current = page.locator('[aria-current="step"]');
    await expect(current).toContainText("Confirmá el reenvío");
    const confirm = current.getByRole("link", { name: "Confirmar reenvío" });
    await expect(confirm).toHaveAttribute("href", CONFIRM_LINK);
    await expect(confirm).toHaveAttribute("target", "_blank");
    await expect(confirm).toHaveAttribute("rel", /noopener/);

    await current.getByRole("button", { name: "Ya lo confirmé" }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText("Importá los filtros");
  });

  test("«Ya importé los filtros» pasa al paso 4", async ({ page }) => {
    await login(page);
    await page.goto("/settings/asistente");
    const current = page.locator('[aria-current="step"]');
    await expect(current).toContainText("Importá los filtros");
    await current.getByRole("button", { name: "Ya importé los filtros" }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText("Esperá tu primera alerta");
  });

  test("llega un email con avisos: paso 5", async ({ page }) => {
    await createInboundEmail({
      subject: `${TAG} alerta`,
      parser: "linkedin_alert",
      error: null,
      jobsExtracted: 1,
      seen: true,
    });
    await login(page);
    await page.goto("/settings/asistente");
    const current = page.locator('[aria-current="step"]');
    await expect(current).toContainText("Listo");
    await expect(current).toContainText("Primera alerta recibida");
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
    for (const id of ["agregar_direccion", "confirmar_reenvio", "importar_filtros"]) {
      await expect(page.getByTestId(`assistant-step-${id}`)).toContainText("(hecho)");
    }
  });
});
