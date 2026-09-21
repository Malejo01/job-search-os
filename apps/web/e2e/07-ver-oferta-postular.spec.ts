import { expect, test, type Page } from "@playwright/test";
import { createJob, deleteJob, jobStatus, login } from "./helpers";

/**
 * Flujo 7 (P0.1): desde la app se llega a la publicación original y, al volver, se confirma a
 * mano si hubo postulación. La confirmación es manual: la app no ve el sitio externo y no
 * detecta nada por su cuenta.
 */
// Misma app: el popup carga sin depender de internet. Una URL por oferta (jobs_user_url es único).
const OFERTA_URL = "http://localhost:3000/api/health?oferta=link-externo";
const OTRA_URL = "http://localhost:3000/api/health?oferta=sin-postular";

let conUrl: string;
let sinUrl: string;
let paraNo: string;

test.describe("Flujo 7: ir a la oferta original y confirmar la postulación", () => {
  test.beforeAll(async () => {
    conUrl = await createJob({
      title: `E2E link externo ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de prueba para el botón de postular.",
      canonicalUrl: OFERTA_URL,
    });
    paraNo = await createJob({
      title: `E2E sin postular ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de prueba para responder que no.",
      canonicalUrl: OTRA_URL,
    });
    sinUrl = await createJob({
      title: `E2E sin link ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de un aviso que llegó sin link.",
      canonicalUrl: null,
    });
  });
  test.afterAll(async () => {
    for (const id of [conUrl, paraNo, sinUrl]) if (id) await deleteJob(id);
  });

  /** Abre la oferta, cierra la pestaña y vuelve a la app: ahí aparece el diálogo. */
  async function postularYVolver(page: Page) {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Postular" }).click(),
    ]);
    await popup.close();
    await page.bringToFront();
    // En un navegador real, volver a la pestaña de la app dispara `focus` y `visibilitychange`.
    // Chromium headless deja todas las pestañas visibles y con foco, así que ese evento no llega
    // solo: se simula lo que el navegador manda al volver.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    return popup;
  }

  test("en la lista hay un link a la publicación que abre en pestaña nueva", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=todas");
    const card = page.getByRole("listitem").filter({ hasText: "E2E link externo" });
    const link = card.getByRole("link", { name: "Ver oferta" });
    await expect(link).toHaveAttribute("href", OFERTA_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);

    // La card sigue llevando al detalle: un link cubre toda la card, debajo del de la oferta
    await card.getByRole("link", { name: /abrir el detalle/i }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${conUrl}`));
  });

  test("en el detalle, Postular abre la oferta y al volver pregunta; Sí deja la oferta aplicada", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${conUrl}`);
    const postular = page.getByRole("link", { name: "Postular" });
    await expect(postular).toHaveAttribute("href", OFERTA_URL);
    await expect(postular).toHaveAttribute("target", "_blank");

    await postularYVolver(page);
    const dialogo = page.getByRole("dialog", { name: /te postulaste/i });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: "Sí" }).click();

    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();
    await expect(dialogo).toHaveCount(0);
    expect(await jobStatus(conUrl)).toBe("aplicada");

    // Ya aplicada: volver a entrar no vuelve a preguntar
    await page.reload();
    await expect(page.getByRole("dialog", { name: /te postulaste/i })).toHaveCount(0);
  });

  test("si contesto que no, no pasa nada", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${paraNo}`);
    await postularYVolver(page);
    const dialogo = page.getByRole("dialog", { name: /te postulaste/i });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: "No" }).click();
    await expect(dialogo).toHaveCount(0);

    await expect(page.getByText("Evaluada", { exact: true })).toBeVisible();
    expect(await jobStatus(paraNo)).toBe("evaluada");
  });

  test("un aviso sin link no muestra botones que no llevan a ningún lado", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${sinUrl}`);
    await expect(page.getByRole("link", { name: "Postular" })).toHaveCount(0);
    // El estado se sigue pudiendo marcar a mano
    await expect(page.getByRole("button", { name: "Marcar aplicada" })).toBeVisible();

    await page.goto("/jobs?estado=todas");
    const card = page.getByRole("listitem").filter({ hasText: "E2E sin link" });
    await expect(card.getByRole("link", { name: "Ver oferta" })).toHaveCount(0);
  });
});
