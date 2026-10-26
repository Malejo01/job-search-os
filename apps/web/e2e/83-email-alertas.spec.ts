import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { closePrivacyDialog, login } from "./helpers";

/**
 * Flujo 83 (C-21b): «Tu email de alertas» es lo primero del asistente; el reenvío desde Gmail queda
 * plegado en «Otra opción». Solo se mira la pantalla: ningún link se abre. El usuario de e2e tiene
 * una dirección del formato anterior y sin emails de reenvío, así que Gmail arranca cerrado.
 */
test.describe("Flujo 83: tu email de alertas en el asistente", () => {
  test("el bloque va primero, con la dirección, el botón de copiar y los tres pasos", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page);
    await page.goto("/settings/asistente");
    await closePrivacyDialog(page);

    const block = page.getByTestId("alert-email");
    await expect(block).toBeVisible();
    await expect(block.getByRole("heading", { name: "Tu email de alertas" })).toBeVisible();
    // Va antes que «Otra opción: reenviar desde Gmail», por posición en la página
    const blockBox = await block.boundingBox();
    const gmailBox = await page.getByTestId("gmail-option").boundingBox();
    expect(blockBox!.y).toBeLessThan(gmailBox!.y);

    const address = (await block.getByTestId("assistant-address").innerText()).trim();
    expect(address).toMatch(/@/);

    await expect(block.getByTestId("alert-email-step-1")).toContainText(
      "Copiá tu dirección de alertas",
    );
    await expect(block.getByTestId("alert-email-step-2")).toContainText("Creá la alerta");
    await expect(block.getByTestId("alert-email-step-2")).toContainText("Crear alerta");
    await expect(block.getByTestId("alert-email-step-2")).toContainText("No hace falta crear");
    await expect(block.getByTestId("alert-email-step-3")).toContainText(
      "Confirmá desde tu bandeja",
    );
    await expect(block.getByTestId("alert-email-step-3").getByRole("link")).toHaveAttribute(
      "href",
      "/inbox",
    );
    // Sin promesas sobre portales sin lector
    await expect(block).toContainText("las procesamos cuando sumemos su lector");
    await expect(block).toContainText("Por ahora leemos automáticamente las alertas de algunos");
    await expect(block).toContainText("Suscribí la alerta de Computrabajo");

    // Copiar: antes de hidratar el clic no hace nada, se reintenta
    const copy = block.getByTestId("alert-email-step-1").locator("button");
    await expect(copy).toHaveText("Copiar");
    await expect(async () => {
      await copy.click();
      await expect(copy).toHaveText("Copiado", { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  });

  test("Bumeran, ZonaJobs e Indeed: una línea por portal con el link a Pegar el aviso", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings/asistente");
    await closePrivacyDialog(page);

    const lines = page.getByTestId("alert-email-other-portals").getByRole("listitem");
    await expect(lines).toHaveCount(3);
    for (const [i, name] of ["Bumeran", "ZonaJobs", "Indeed"].entries()) {
      await expect(lines.nth(i)).toContainText(name);
      await expect(lines.nth(i).getByRole("link")).toHaveAttribute("href", "/jobs/new?modo=pegar");
    }
    await expect(page.getByTestId("alert-email")).toContainText("piden una cuenta");
  });

  test("Gmail está plegado y se abre con el teclado", async ({ page }) => {
    await login(page);
    await page.goto("/settings/asistente");
    await closePrivacyDialog(page);

    const option = page.getByTestId("gmail-option");
    await expect(option).toHaveJSProperty("open", false);
    await expect(option.locator("summary")).toHaveText("Otra opción: reenviar desde Gmail");
    await expect(page.getByTestId("assistant-step-agregar_direccion")).toBeHidden();

    await option.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(option).toHaveJSProperty("open", true);
    await expect(page.getByTestId("assistant-step-agregar_direccion")).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(option).toHaveJSProperty("open", false);
  });

  test("axe sin violaciones con Gmail cerrado y abierto, y a 390 px los botones miden 44 px", async ({
    page,
  }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/asistente");
    await closePrivacyDialog(page);

    const check = async (label: string) => {
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      // Regla, impacto y selectores; nunca el HTML entero
      const resumen = violations.map(
        (v) =>
          `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      );
      expect(resumen, label).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        label,
      ).toBeLessThanOrEqual(390);
    };

    await check("con Gmail cerrado");

    const block = page.getByTestId("alert-email");
    const targets = [
      ...(await block.getByRole("button").all()),
      ...(await block.getByRole("link").all()),
      page.getByTestId("gmail-option").locator("summary"),
    ];
    for (const target of targets) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await page.getByTestId("gmail-option").locator("summary").click();
    await expect(page.getByTestId("gmail-option")).toHaveJSProperty("open", true);
    await check("con Gmail abierto");
  });
});
