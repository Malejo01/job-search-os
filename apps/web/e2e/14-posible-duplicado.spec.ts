import { expect, test } from "@playwright/test";
import {
  createEvaluation,
  createJob,
  deleteJob,
  jobMergeState,
  login,
  markPossibleDuplicate,
} from "./helpers";

/**
 * Flujo 14 (JS-025): posible_duplicado visible en la lista y en el detalle, con fusión manual
 * y "no son la misma" (ADR-013). Si las dos ofertas tienen evaluación o postulación, no se
 * ofrece fusionar: se perdería una.
 */
test.describe("Flujo 14: posibles duplicados", () => {
  const tag = Date.now();
  const creados: string[] = [];

  test.afterAll(async () => {
    for (const id of creados) await deleteJob(id);
  });

  async function par(nombre: string, dupConHistoria = false) {
    const orig = await createJob({
      title: `E2E original ${nombre} ${tag}`,
      status: "evaluada",
      jdText: "JD completa del aviso original, con requisitos y beneficios.",
    });
    await createEvaluation(orig);
    const dup = await createJob({
      title: `E2E parecido ${nombre} ${tag}`,
      status: dupConHistoria ? "evaluada" : "pendiente_jd",
    });
    if (dupConHistoria) await createEvaluation(dup);
    await markPossibleDuplicate(dup, orig);
    creados.push(orig, dup);
    return { orig, dup };
  }

  test("se ve en la lista, se revisa en el detalle y se fusiona sin perder la fuente", async ({
    page,
  }) => {
    const { orig, dup } = await par("fusion");
    await login(page);

    // En /jobs: aviso con la cantidad y filtro que muestra solo los marcados
    await page.goto("/jobs");
    await page.getByRole("link", { name: /posibles? duplicados? para revisar/ }).click();
    await expect(page).toHaveURL(/duplicados=1/);
    const card = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({
        hasText: `E2E parecido fusion ${tag}`,
      });
    await expect(card).toBeVisible();
    await expect(card).toContainText("posible duplicado");
    await expect(
      page
        .getByRole("main")
        .getByRole("listitem")
        .filter({ hasText: `E2E original fusion ${tag}` }),
    ).toHaveCount(0);

    // En el detalle del marcado: link al parecido y las dos acciones
    await page.goto(`/jobs/${dup}`);
    const revisar = page.getByRole("region", { name: "Posible duplicado" });
    await expect(revisar.getByRole("link", { name: `E2E original fusion ${tag}` })).toHaveAttribute(
      "href",
      `/jobs/${orig}`,
    );
    page.once("dialog", (d) => d.accept());
    await revisar.getByRole("button", { name: "Fusionar" }).click();

    // Queda el original (tiene evaluación) con las dos fuentes; el parecido se borra
    await expect(page).toHaveURL(new RegExp(`/jobs/${orig}$`));
    await expect(page.getByRole("region", { name: "Posible duplicado" })).toHaveCount(0);
    expect(await jobMergeState(dup)).toBeNull();
    expect(await jobMergeState(orig)).toMatchObject({ sources: 2, duplicateOfId: null });
    expect((await jobMergeState(orig))!.flags).not.toContain("posible_duplicado");
  });

  test("«no son la misma» saca la marca y la oferta sale de la lista de duplicados", async ({
    page,
  }) => {
    const { orig, dup } = await par("distintas");
    await login(page);

    // El original avisa que tiene un posible duplicado
    await page.goto(`/jobs/${orig}`);
    await expect(
      page.getByRole("region", { name: "Posibles duplicados de esta oferta" }).getByRole("link", {
        name: `E2E parecido distintas ${tag}`,
      }),
    ).toHaveAttribute("href", `/jobs/${dup}`);

    await page.goto(`/jobs/${dup}`);
    await page
      .getByRole("region", { name: "Posible duplicado" })
      .getByRole("button", { name: "No son la misma" })
      .click();
    await expect(page.getByRole("region", { name: "Posible duplicado" })).toHaveCount(0);
    expect(await jobMergeState(dup)).toMatchObject({ duplicateOfId: null, flags: [] });

    await page.goto("/jobs?duplicados=1&estado=todas");
    await expect(
      page
        .getByRole("main")
        .getByRole("listitem")
        .filter({ hasText: `E2E parecido distintas ${tag}` }),
    ).toHaveCount(0);
  });

  test("si las dos tienen evaluación, no se ofrece fusionar", async ({ page }) => {
    const { dup } = await par("historia", true);
    await login(page);
    await page.goto(`/jobs/${dup}`);
    const revisar = page.getByRole("region", { name: "Posible duplicado" });
    await expect(revisar).toContainText("Las dos ofertas tienen evaluación o postulación");
    await expect(revisar.getByRole("button", { name: "Fusionar" })).toHaveCount(0);
    await expect(revisar.getByRole("button", { name: "No son la misma" })).toBeVisible();
  });
});
