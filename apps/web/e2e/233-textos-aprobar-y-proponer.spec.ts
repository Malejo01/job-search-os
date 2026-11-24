import { expect, test } from "@playwright/test";
import { login, removeSecondUser } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";
import { TEXTO_ALTO, TEXTO_MEDIO, clearTextReviews, textReviewsOf } from "./revision-helpers";

/**
 * Flujo 233 (R26-02): en `/admin/textos`, quien administra aprueba un texto del rediseño o propone otro. La
 * aprobación queda en la base con la huella del texto de hoy; la propuesta aparece en «Propuestas de Ani» con un
 * botón «Copiar» y NO cambia la app (el texto por defecto sigue igual). Con la persona de prueba (admin del e2e).
 */
test.describe("Flujo 233: textos del rediseño, aprobar y proponer (R26-02)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await ensureSeedPerson();
    await clearTextReviews();
  });
  test.afterAll(async () => {
    await clearTextReviews();
    await removeSecondUser().catch(() => {});
  });

  test("aprobar un texto lo marca aprobado y suma al conteo", async ({ page }) => {
    await login(page);
    await page.goto("/admin/textos");
    const fila = page.getByTestId(`texto-${TEXTO_ALTO}`);
    await expect(fila.getByTestId("texto-estado")).toHaveText("Sin revisar");
    const antes = Number(
      (await page.getByTestId("textos-resumen").innerText()).match(/^(\d+) de/)![1],
    );

    await fila.getByTestId("texto-aprobar").click();
    await expect(fila.getByTestId("texto-estado")).toHaveText("Aprobado");
    await expect(fila.getByTestId("texto-aprobar")).toHaveCount(0);
    await expect(page.getByTestId("textos-resumen")).toContainText(
      new RegExp(`^${antes + 1} de \\d+ aprobados$`),
    );
    expect(await textReviewsOf(TEXTO_ALTO)).toEqual([{ status: "aprobada", proposal: null }]);
  });

  test("proponer otro guarda la propuesta, la lista en «Propuestas de Ani» y no cambia el texto", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await login(page);
    await page.goto("/admin/textos");
    const fila = page.getByTestId(`texto-${TEXTO_MEDIO}`);
    const original = await fila.locator("blockquote").innerText();
    await expect(page.getByTestId("propuestas-vacia")).toBeVisible();

    await fila.getByText("Proponer otro").click();
    // Sin texto no se envía (required) y no se guarda nada
    await fila.getByTestId("texto-proponer").click();
    expect(await textReviewsOf(TEXTO_MEDIO)).toEqual([]);

    await fila.getByLabel("Tu texto").fill("Va bien encaminado");
    await fila.getByTestId("texto-proponer").click();
    await expect(fila.getByTestId("texto-estado")).toHaveText("Propuesta guardada");
    expect(await textReviewsOf(TEXTO_MEDIO)).toEqual([
      { status: "propuesta", proposal: "Va bien encaminado" },
    ]);

    // «Propuestas de Ani»: el texto propuesto y «Copiar»
    const propuesta = page.getByTestId(`propuesta-${TEXTO_MEDIO}`);
    await expect(propuesta.getByTestId("propuesta-texto")).toHaveText("Va bien encaminado");
    await propuesta.getByTestId("propuesta-copiar").click();
    await expect(propuesta.getByTestId("propuesta-copiar")).toHaveAttribute("data-copiado", "1");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Va bien encaminado");

    // No cambió la app: el texto por defecto sigue igual, y la fila no figura como aprobada
    await page.reload();
    await expect(page.getByTestId(`texto-${TEXTO_MEDIO}`).locator("blockquote")).toHaveText(
      original,
    );
    await expect(
      page.getByTestId(`texto-${TEXTO_MEDIO}`).getByTestId("texto-estado"),
    ).not.toHaveText("Aprobado");
  });
});
