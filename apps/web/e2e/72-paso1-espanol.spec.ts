import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 72 (paso 1, A-2 y A-9): cada carrera muestra «en español: N»; con «Solo en español» y una
 * carrera con menos de 10 ofertas en español sale un aviso no bloqueante, y con «En los dos» no.
 * Además la ayuda del resumen trae tres ejemplos inventados, el del grupo elegido primero.
 *
 * El pool del CI tiene pocos datos y el servidor cachea 30 minutos: se elige una carrera cuyo número
 * ya está en pantalla (`data-count`) y se verifica contra ese número, nunca contra una cifra fija.
 * Todo inventado (persona `@personas.test`).
 */
test.describe("Flujo 72: paso 1, español y ejemplos de resumen", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  let context: BrowserContext | undefined;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await createInvitation(run);
    context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await cleanup(run, context);
  });

  test("«en español: N» en cada carrera y aviso solo con «Solo en español»", async () => {
    await register(page, run);

    const counts = page.locator('[data-testid^="career-spanish-"]');
    await expect(counts.first()).toBeVisible();
    await expect(counts.first()).toHaveText(/^en español: \d+$/);

    // Una carrera con menos de 10 ofertas en español (la primera que haya)
    let fewKey: string | null = null;
    for (const el of await counts.all()) {
      const n = Number(await el.getAttribute("data-count"));
      if (n < 10) {
        fewKey = (await el.getAttribute("data-testid"))!.replace("career-spanish-", "");
        break;
      }
    }
    test.skip(
      fewKey === null,
      "el pool de esta base tiene 10 o más ofertas en español por carrera",
    );

    await page.locator(`input[name="targetRoles"][value="${fewKey}"]`).check();
    const notice = page.getByTestId(`few-spanish-${fewKey}`);

    await page.getByRole("radio", { name: "En los dos" }).check();
    await expect(notice).toHaveCount(0);

    await page.getByRole("radio", { name: "Solo en español" }).check();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("casi no hay ofertas en español (");
    await expect(notice).toContainText("Si aceptás ofertas en inglés vas a ver muchas más.");
    await expect(page.getByTestId("few-spanish-notice")).toHaveAttribute("aria-live", "polite");

    // No bloquea y no desborda a 360 px
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      "sin scroll horizontal a 360 px",
    ).toBe(true);

    await page.getByRole("radio", { name: "En los dos" }).check();
    await expect(notice).toHaveCount(0);
  });

  test("tres ejemplos de resumen: plegados sin carrera, el del grupo primero con carrera", async () => {
    const help = page.locator("#summary-help");
    const more = help.getByTestId("summary-examples-more");

    // Sin carrera elegida: los tres, plegados
    for (const box of await page.locator('input[name="targetRoles"]:checked').all()) {
      await box.uncheck();
    }
    await expect(more).toHaveJSProperty("open", false);
    await more.locator("summary").click();
    for (const id of ["tecnologia", "producto", "ventas"]) {
      await expect(help.getByTestId(`summary-example-${id}`)).toBeVisible();
    }

    // Con una carrera de ventas: su ejemplo queda a la vista, fuera del plegable
    await page.locator('input[name="targetRoles"][value="ventas_b2b"]').check();
    const own = help.getByTestId("summary-example-ventas");
    await expect(own).toBeVisible();
    await expect(more.getByTestId("summary-example-ventas")).toHaveCount(0);
    await expect(more.getByTestId("summary-example-tecnologia")).toHaveCount(1);
  });
});
