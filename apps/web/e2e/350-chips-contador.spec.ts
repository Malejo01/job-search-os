import { expect, test } from "@playwright/test";
import { deleteJob, login } from "./helpers";
import { createEvaluatedJob } from "./listado-helpers";

/**
 * Flujo 350 (R30-05): pestañas, chips con su número, el activo con ×, contador real, «Limpiar filtros»
 * y los filtros en la URL (se comparten y «atrás» vuelve). Datos inventados.
 */
test.describe("Flujo 350: pestañas, chips y contador", () => {
  const tag = Date.now();
  const titleRemote = `Oferta ficticia remota ${tag}`;
  const titleOnsite = `Oferta ficticia presencial ${tag}`;
  const ids: string[] = [];

  test.beforeAll(async () => {
    ids.push(
      await createEvaluatedJob({ title: titleRemote, score: 8, modality: "remoto" }),
      await createEvaluatedJob({
        title: titleOnsite,
        score: 7,
        modality: "presencial",
        locationRaw: "Ciudad Ficticia",
      }),
    );
  });

  test.afterAll(async () => {
    for (const id of ids) await deleteJob(id);
  });

  test("las cinco pestañas, con la de Por revisar activa", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    const nav = page.getByRole("navigation", { name: "Pestañas de ofertas" });
    for (const name of ["Por revisar", "Guardadas", "Ya me postulé", "Descartadas", "Todas"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Por revisar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("el chip Remoto trae su número, se marca con × y el contador dice cuántas quedan", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const chip = page.getByTestId("chip-remoto");
    await expect(chip).toContainText(/Remoto · \d+/);
    const before = await page.getByTestId("tarjeta-oferta").count();
    await chip.click();
    await expect(page).toHaveURL(/modalidad=remoto/);
    await expect(page.getByTestId("chip-remoto")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("chip-remoto")).toContainText("×");
    await expect(page.getByRole("listitem").filter({ hasText: titleOnsite })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: titleRemote })).toBeVisible();
    const shown = await page.getByTestId("tarjeta-oferta").count();
    expect(shown).toBeLessThan(before);
    await expect(page.getByTestId("jobs-contador")).toHaveText(
      shown === 1 ? "1 oferta con estos filtros" : `${shown} ofertas con estos filtros`,
    );
  });

  test("«Limpiar filtros» vuelve a todo y «atrás» recupera el filtro", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?modalidad=remoto");
    await page.getByTestId("limpiar-filtros").click();
    await expect(page).not.toHaveURL(/modalidad=/);
    await expect(page.getByRole("listitem").filter({ hasText: titleOnsite })).toBeVisible();
    await expect(page.getByTestId("limpiar-filtros")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/modalidad=remoto/);
    await expect(page.getByRole("listitem").filter({ hasText: titleOnsite })).toHaveCount(0);
  });

  test("sin resultados: estado vacío con la salida «Limpiar filtros»", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?inicio=1&modalidad=remoto&idioma=es&estado=todas");
    await expect(page.getByTestId("jobs-empty-filtros")).toBeVisible();
    await page
      .getByTestId("jobs-empty-filtros")
      .getByRole("link", { name: "Limpiar filtros" })
      .click();
    await expect(page).toHaveURL(/\/jobs$/);
  });

  test("«+ Agregar una oferta» con su aclaración", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    await expect(page.getByTestId("agregar-oferta")).toHaveText("+ Agregar una oferta");
    await expect(
      page.getByText("Traé un aviso que viste en otro sitio y lo evaluamos"),
    ).toBeVisible();
  });
});
