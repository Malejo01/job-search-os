import { expect, test } from "@playwright/test";
import { deleteJob, login } from "./helpers";
import { createEvaluatedJob } from "./listado-helpers";

/**
 * Flujo 349 (R30-04): la tarjeta dice puesto, empresa, modalidad, sello con número, sueldo solo si el
 * aviso lo publica y, de la tabla de requisitos, «No coincide: …» arriba y «Sin confirmar: …» con hasta
 * 2 cosas. La oferta con una condición excluyente que no coincide baja en el orden aunque tenga más
 * afinidad. Datos inventados.
 */
test.describe("Flujo 349: la tarjeta", () => {
  const tag = Date.now();
  const titleBlocked = `Oferta ficticia excluyente ${tag}`;
  const titleOk = `Oferta ficticia común ${tag}`;
  const ids: string[] = [];

  test.beforeAll(async () => {
    ids.push(
      await createEvaluatedJob({
        title: titleBlocked,
        score: 9.9,
        items: [
          {
            id: "residencia",
            status: "no_cumple",
            pide: "Residir en EE. UU.",
            tenes: "Argentina",
            bloquea: true,
          },
        ],
      }),
      await createEvaluatedJob({
        title: titleOk,
        score: 9.5,
        salary: { min: 350, max: 870, period: "mensual" },
        items: [
          { id: "pais", status: "cumple", pide: "Disponible en Argentina", tenes: "Argentina" },
          { id: "ingles", status: "no_se_sabe", pide: "Inglés avanzado", tenes: null },
          { id: "anos", status: "no_se_sabe", pide: "5 años", tenes: null, nivel: "deseable" },
          {
            id: "skill:go",
            kind: "skill",
            nivel: "deseable",
            status: "no_se_sabe",
            pide: "Menciona Go",
            tenes: null,
          },
        ],
      }),
    );
  });

  test.afterAll(async () => {
    for (const id of ids) await deleteJob(id);
  });

  test("condición excluyente arriba, texto con ícono, y la oferta baja en el orden", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const blocked = page.getByRole("listitem").filter({ hasText: titleBlocked });
    await expect(blocked.getByTestId("tarjeta-no-coincide")).toHaveText(
      "No coincide: residir en EE. UU.",
    );
    // La condición excluyente no esconde ni borra la oferta, pero queda debajo de la común
    const titles = await page.getByTestId("tarjeta-titulo").allTextContents();
    expect(titles.indexOf(titleOk)).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf(titleBlocked)).toBeGreaterThan(titles.indexOf(titleOk));
  });

  test("sueldo solo si el aviso lo publica y «Sin confirmar» con hasta 2 cosas", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const ok = page.getByRole("listitem").filter({ hasText: titleOk });
    await expect(ok.getByTestId("tarjeta-salario")).toHaveText("USD 350–870 por mes");
    await expect(ok.getByTestId("tarjeta-sin-confirmar")).toHaveText(
      "Sin confirmar: inglés avanzado, 5 años",
    );
    await expect(ok.getByTestId("tarjeta-no-coincide")).toHaveCount(0);
    const blocked = page.getByRole("listitem").filter({ hasText: titleBlocked });
    await expect(blocked.getByTestId("tarjeta-salario")).toHaveCount(0);
  });

  test("empresa y modalidad en una línea, sin repetir, y los tres botones", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    const ok = page.getByRole("listitem").filter({ hasText: titleOk });
    await expect(ok.getByTestId("tarjeta-empresa")).toHaveText("E2E Testing SA · Remoto");
    await expect(ok.getByRole("link", { name: "Ver oferta" })).toBeVisible();
    await expect(ok.getByRole("button", { name: /^Guardar/ })).toBeVisible();
    await expect(ok.getByRole("button", { name: /^Descartar/ })).toBeVisible();
    // Nada de «Tenés», «Te falta» ni predicciones
    await expect(ok).not.toContainText(/Te falta|Tenés:|entre las mejores/);
  });
});
