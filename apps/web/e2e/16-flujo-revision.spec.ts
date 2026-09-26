import { expect, test, type Page } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, jobStatus, login } from "./helpers";

/**
 * Flujo 16 (JS-061): recorrer las ofertas de mayor a menor score salteando las que ya tienen una
 * acción tomada. Por defecto la lista muestra solo lo sin revisar; el avance cuenta las verdes
 * del período en cualquier estado; "siguiente" usa el mismo orden que la lista.
 *
 * Las ofertas de este flujo llevan scores de 9,6 a 9,9 para quedar arriba de todo: el resto de
 * los flujos usa 7, así el orden es determinista aunque quede algún resto de otra corrida.
 */
test.describe("Flujo 16: revisión de a una", () => {
  const tag = Date.now();
  const creados: string[] = [];
  const nombre = (n: string) => `E2E revision ${n} ${tag}`;
  let A = "";
  let B = "";

  test.afterAll(async () => {
    for (const id of creados) await deleteJob(id);
  });

  /** "X de Y" del indicador de avance; 0 de 0 si todavía no hay verdes en el período. */
  async function avance(page: Page): Promise<{ hechas: number; total: number }> {
    const bar = page.getByRole("progressbar", { name: "Ofertas verdes revisadas" });
    if ((await bar.count()) === 0) return { hechas: 0, total: 0 };
    return {
      hechas: Number(await bar.getAttribute("aria-valuenow")),
      total: Number(await bar.getAttribute("aria-valuemax")),
    };
  }

  const tarjeta = (page: Page, n: string) =>
    page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: nombre(n) });

  test("por defecto solo lo sin revisar, y el avance cuenta las verdes en cualquier estado", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs?periodo=hoy");
    const antes = await avance(page);

    A = await createJob({ title: nombre("A"), status: "evaluada" });
    await createEvaluation(A, { score: 9.9 });
    B = await createJob({ title: nombre("B"), status: "evaluada" });
    await createEvaluation(B, { score: 9.8 });
    const C = await createJob({ title: nombre("C"), status: "aplicada" });
    await createEvaluation(C, { score: 9.7 });
    const D = await createJob({ title: nombre("D"), status: "evaluada" });
    await createEvaluation(D, { score: 9.6, accion: "guardar" });
    creados.push(A, B, C, D);

    // Sin parámetros: la aplicada no aparece; las que no tienen acción tomada sí
    await page.goto("/jobs");
    await expect(page.getByLabel("Estado")).toHaveValue("");
    await expect(tarjeta(page, "A")).toBeVisible();
    await expect(tarjeta(page, "B")).toBeVisible();
    await expect(tarjeta(page, "D")).toBeVisible();
    await expect(tarjeta(page, "C")).toHaveCount(0);

    // Con "todas" vuelve a aparecer: el toggle de "mostrar todas" es el mismo select
    await page.getByLabel("Estado").selectOption("todas");
    await expect(page).toHaveURL(/estado=todas/);
    await expect(tarjeta(page, "C")).toBeVisible();

    // Avance del día: 3 verdes nuevas (A, B, C; D es "guardar"), 1 ya revisada (C, aplicada)
    await page.goto("/jobs?periodo=hoy");
    await expect(page.getByLabel("Período")).toHaveValue("hoy");
    const despues = await avance(page);
    expect(despues.total - antes.total).toBe(3);
    expect(despues.hechas - antes.hechas).toBe(1);
  });

  test("elegir un período limpia el Desde manual, y al revés", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?desde=2026-01-01");
    await page.getByLabel("Período").selectOption("semana");
    await expect(page).toHaveURL(/periodo=semana/);
    await expect(page).not.toHaveURL(/desde=/);
  });

  test("siguiente sigue el orden de la lista, también después de actuar; el atajo no se dispara escribiendo", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");

    // A es la primera (9,9): se abre desde la lista y el detalle trae los filtros
    await tarjeta(page, "A")
      .getByRole("link", { name: `Abrir el detalle de ${nombre("A")}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${A}`));
    const nav = page.getByRole("navigation", { name: "Revisión de ofertas" });
    await expect(nav.getByRole("link", { name: "Siguiente →" })).toHaveAttribute(
      "href",
      new RegExp(`/jobs/${B}`),
    );

    // Atajos: j = siguiente, k = anterior
    await page.keyboard.press("j");
    await expect(page).toHaveURL(new RegExp(`/jobs/${B}`));
    await page.keyboard.press("k");
    await expect(page).toHaveURL(new RegExp(`/jobs/${A}`));

    // Escribiendo en un campo, "j" es una letra y no un atajo
    const nota = page.getByLabel("Nota");
    await nota.click();
    await nota.pressSequentially("jk");
    await expect(page).toHaveURL(new RegExp(`/jobs/${A}`));
    await expect(nota).toHaveValue("jk");
    await nota.blur();

    // Actuar sobre A: deja de estar sin revisar, pero "siguiente" la ubica y sigue a B
    await page
      .getByRole("region", { name: "Estado" })
      .getByRole("button", { name: "Descartar" })
      .click();
    await expect.poll(() => jobStatus(A)).toBe("descartada");
    await expect(nav.getByRole("link", { name: "Siguiente →" })).toHaveAttribute(
      "href",
      new RegExp(`/jobs/${B}`),
    );
    await nav.getByRole("link", { name: "Siguiente →" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${B}`));

    // Volver a la lista: A ya no está (tiene una acción tomada), B sigue
    await nav.getByRole("link", { name: "← Ofertas" }).click();
    await expect(tarjeta(page, "B")).toBeVisible();
    await expect(tarjeta(page, "A")).toHaveCount(0);
  });
});
