import { composeFeedbackMessage } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";
import { ensureSecondUser, login, removeSecondUser } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";
import { UUID_FICTICIO, clearFeedbackOf, seedFeedbackRows } from "./recorrido-helpers";

/**
 * Flujo 239 (R26-04): `/admin/feedback` agrupa los comentarios por pantalla (con conteo), filtra por pantalla y por
 * estado y muestra el texto completo con la sugerencia aparte. Los comentarios viejos, guardados con el id en la
 * ruta, caen en la misma pantalla que los nuevos. Entra la persona de prueba admin (`ADMIN_EMAILS` en el servidor).
 */
test.describe("Flujo 239: feedback por pantalla en el panel", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
  test.describe.configure({ mode: "serial" });
  const tag = `pantalla-${Date.now()}`;

  test.beforeAll(async () => {
    await ensureSeedPerson();
    await ensureSecondUser();
    await clearFeedbackOf();
    await seedFeedbackRows([
      // Guardado antes de normalizar: lleva el id real en la ruta
      { path: `/jobs/${UUID_FICTICIO}`, message: `${tag} no encuentro el sello` },
      {
        path: "/jobs/[id]",
        message: composeFeedbackMessage(`${tag} el puntaje asusta`, "Que lo explique con palabras"),
        status: "visto",
      },
      { path: "/hoy", message: `${tag} Hoy se ve vacío`, category: "confuso" },
    ]);
  });
  test.afterAll(async () => {
    await clearFeedbackOf();
    await removeSecondUser();
  });

  test("agrupa por pantalla sin ids, con conteo, de la más comentada a la menos", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/feedback");
    const grupos = page.getByTestId("feedback-pantalla-grupo");
    await expect(grupos.filter({ hasText: "/jobs/[id]" })).toContainText("2");
    await expect(grupos.filter({ hasText: "/hoy" })).toContainText("1");
    // La ruta con el id real no se muestra en ningún lado
    await expect(page.getByTestId("feedback-por-pantalla")).not.toContainText(UUID_FICTICIO);
    await expect(page.getByTestId("feedback-lista")).not.toContainText(UUID_FICTICIO);
  });

  test("tocar una pantalla deja solo sus comentarios, con el texto completo y la sugerencia aparte", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/feedback");
    await page.getByTestId("feedback-pantalla-grupo").filter({ hasText: "/jobs/[id]" }).click();
    await expect(page).toHaveURL(/pantalla=%2Fjobs%2F%5Bid%5D/);
    const items = page.getByTestId("feedback-item").filter({ hasText: tag });
    await expect(items).toHaveCount(2);
    await expect(
      page.getByTestId("feedback-item").filter({ hasText: "Hoy se ve vacío" }),
    ).toHaveCount(0);

    const conSugerencia = items.filter({ hasText: "el puntaje asusta" });
    await expect(conSugerencia.getByTestId("feedback-mensaje")).toHaveText(
      `${tag} el puntaje asusta`,
    );
    await expect(conSugerencia.getByTestId("feedback-sugerencia")).toContainText(
      "Que lo explique con palabras",
    );
    // El otro comentario no tiene sugerencia
    await expect(
      items.filter({ hasText: "no encuentro el sello" }).getByTestId("feedback-sugerencia"),
    ).toHaveCount(0);
  });

  test("filtra por pantalla y estado a la vez, desde el formulario", async ({ page }) => {
    await login(page);
    await page.goto("/admin/feedback");
    await page.locator('select[name="pantalla"]').selectOption("/jobs/[id]");
    await page.locator('select[name="estado"]').selectOption("visto");
    await page.getByRole("button", { name: "Filtrar" }).click();
    const items = page.getByTestId("feedback-item").filter({ hasText: tag });
    await expect(items).toHaveCount(1);
    await expect(items).toContainText("el puntaje asusta");
    await expect(items).toContainText("Visto");
  });
});
