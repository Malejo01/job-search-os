import { expect, test } from "@playwright/test";
import { login, loginAsSecondUser, removeSecondUser } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";
import { ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";
import {
  TEXTO_ALTO,
  clearTextReviews,
  makeBTester,
  removeBTesterRole,
  textReviewsOf,
} from "./revision-helpers";

/**
 * Flujo 234 (R26-02): una tester (persona B, con el rol en la base) revisa los textos en `/settings/textos` y su
 * aprobación se cuenta en la checklist de apertura. Una persona común recibe 404, y una tester solo por variable de
 * entorno (sin el rol en la base) ve los textos pero no puede aprobar.
 */
test.describe("Flujo 234: textos para testers y checklist de apertura (R26-02)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await makeBTester();
    await clearTextReviews();
  });
  test.afterAll(async () => {
    await clearTextReviews();
    await removeOffUser().catch(() => {});
    await removeSecondUser().catch(() => {});
  });

  test("la tester aprueba un texto desde /settings/textos", async ({ page }) => {
    await loginAsSecondUser(page);
    const res = await page.goto("/settings/textos");
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Textos del rediseño" }),
    ).toBeVisible();
    const fila = page.getByTestId(`texto-${TEXTO_ALTO}`);
    await fila.getByTestId("texto-aprobar").click();
    await expect(fila.getByTestId("texto-estado")).toHaveText("Aprobado");
    expect(await textReviewsOf(TEXTO_ALTO)).toEqual([{ status: "aprobada", proposal: null }]);
  });

  test("la checklist de apertura cuenta los textos aprobados desde la base", async ({ page }) => {
    test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
    await ensureSeedPerson();
    await login(page);
    await page.goto("/admin/textos");
    const resumen = (await page.getByTestId("textos-resumen").innerText()).match(/^(\d+) de (\d+)/);
    expect(resumen).not.toBeNull();
    const [, aprobados, total] = resumen!;
    // Como mínimo, el que aprobó la tester en el test anterior
    expect(Number(aprobados)).toBeGreaterThanOrEqual(1);

    await page.goto("/admin/apertura");
    const fila = page.getByTestId("apertura-textos");
    await expect(fila).toHaveAttribute("data-estado", "pendiente");
    await expect(fila).toContainText(
      `${Number(total) - Number(aprobados)} de ${total} siguen con el valor por defecto`,
    );
  });

  test("una persona común recibe 404", async ({ page }) => {
    await ensureOffUser();
    await loginAsOffUser(page);
    expect((await page.goto("/settings/textos"))?.status()).toBe(404);
  });

  test("una tester sin el rol en la base lee los textos pero no puede aprobar ni proponer", async ({
    page,
  }) => {
    await removeBTesterRole();
    await loginAsSecondUser(page);
    expect((await page.goto("/settings/textos"))?.status()).toBe(200);
    await expect(page.getByText("No pudimos leer las revisiones")).toBeVisible();
    await expect(page.getByTestId(`texto-${TEXTO_ALTO}`)).toBeVisible();
    await expect(page.getByTestId("texto-aprobar")).toHaveCount(0);
    await expect(page.getByTestId("texto-proponer")).toHaveCount(0);
  });
});
