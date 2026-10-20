import { expect, test } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, evaluationFeedbackOf, login } from "./helpers";

/**
 * Flujo 36 (ronda 30): feedback de un toque. 👍/👎 sobre la evaluación, con motivo corto opcional,
 * en el detalle y en las tarjetas de /jobs. No toca el score humano, y el numérico no pisa el veredicto.
 */
test.describe("Flujo 36: feedback de un toque", () => {
  test.describe.configure({ mode: "serial" });
  const tag = Date.now();
  const creados: string[] = [];
  let detalle = "";
  let tarjeta = "";
  const tituloTarjeta = `E2E veredicto tarjeta ${tag}`;

  test.beforeAll(async () => {
    detalle = await createJob({ title: `E2E veredicto detalle ${tag}`, status: "evaluada" });
    await createEvaluation(detalle, { score: 9.5 });
    tarjeta = await createJob({ title: tituloTarjeta, status: "evaluada" });
    await createEvaluation(tarjeta, { score: 9.4 });
    creados.push(detalle, tarjeta);
  });

  test("motivo y score en la misma página (sin recargar): el score no pisa el motivo", async ({
    page,
  }) => {
    const mismo = await createJob({
      title: `E2E veredicto mismo render ${tag}`,
      status: "evaluada",
    });
    await createEvaluation(mismo, { score: 9.3 });
    creados.push(mismo);
    await login(page);
    await page.goto(`/jobs/${mismo}`);
    await page
      .getByRole("group", { name: "¿Te sirve esta evaluación?" })
      .getByRole("button", { name: "No, no me sirve", exact: true })
      .click();
    await page.getByRole("button", { name: "sueldo" }).click();
    await page.getByRole("button", { name: "Guardar motivo" }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(mismo))?.humanNote).toBe("sueldo");

    // Sin page.goto: el formulario numérico se remonta con la nota nueva al revalidar
    await page.getByText("Corregir el puntaje").click();
    await expect(page.getByLabel("Nota")).toHaveValue("sueldo");
    await page.getByLabel("Score humano (0–10)").fill("6");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(mismo))?.humanScore).toBe(6);
    const fila = await evaluationFeedbackOf(mismo);
    expect(fila?.humanNote).toBe("sueldo");
    expect(fila?.humanVerdict).toBe("en_desacuerdo");
    // Sin recargar: el formulario se remonta y muestra lo guardado
    await expect(page.getByLabel("Score humano (0–10)")).toHaveValue("6");
  });

  test("guardar motivo no vacía el campo; sin cambios queda deshabilitado; quitar lo borra", async ({
    page,
  }) => {
    const motivo = await createJob({
      title: `E2E veredicto motivo ${tag}`,
      status: "evaluada",
    });
    await createEvaluation(motivo, { score: 9.2 });
    creados.push(motivo);
    await login(page);
    await page.goto(`/jobs/${motivo}`);
    await page
      .getByRole("group", { name: "¿Te sirve esta evaluación?" })
      .getByRole("button", { name: "No, no me sirve", exact: true })
      .click();

    const guardar = page.getByRole("button", { name: "Guardar motivo", exact: true });
    const campo = page.getByLabel("Motivo", { exact: true });
    await expect(guardar).toBeDisabled(); // vacío
    await page.getByRole("button", { name: "sueldo", exact: true }).click();
    await expect(guardar).toBeEnabled();
    await guardar.click();

    // Sin page.goto: el campo sigue mostrando el texto y aparece la confirmación
    await expect(page.getByRole("status").filter({ hasText: "Guardado ✓" })).toBeVisible();
    await expect(campo).toHaveValue("sueldo");
    await expect(guardar).toBeDisabled(); // igual al guardado
    await expect.poll(async () => (await evaluationFeedbackOf(motivo))?.humanNote).toBe("sueldo");

    await page.reload();
    await expect(campo).toHaveValue("sueldo");

    await page.getByRole("button", { name: "Quitar motivo", exact: true }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(motivo))?.humanNote).toBeNull();
    await expect(campo).toHaveValue("");
    await expect(page.getByRole("button", { name: "Quitar motivo", exact: true })).toHaveCount(0);
  });

  test("tarjeta en 360 px: sin scroll horizontal y botones de al menos 44x44", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page);
    await page.goto("/jobs");
    const item = page.getByRole("main").getByRole("listitem").filter({ hasText: tituloTarjeta });
    for (const name of ["Me sirve la evaluación", "No me sirve la evaluación"]) {
      // exact: "Me sirve…" es subcadena de "No me sirve…"
      const box = await item.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const sinScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(sinScroll).toBe(true);
  });

  test.afterAll(async () => {
    for (const id of creados) await deleteJob(id);
  });

  test("detalle: 'No' con motivo persiste al recargar", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${detalle}`);
    const grupo = page.getByRole("group", { name: "¿Te sirve esta evaluación?" });
    const no = grupo.getByRole("button", { name: "No, no me sirve", exact: true });
    await expect(no).toHaveAttribute("aria-pressed", "false");
    await no.click();
    await expect(no).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "el score está alto" }).click();
    await expect(page.getByLabel("Motivo")).toHaveValue("el score está alto");
    await page.getByRole("button", { name: "Guardar motivo" }).click();

    await page.reload();
    await expect(
      page
        .getByRole("group", { name: "¿Te sirve esta evaluación?" })
        .getByRole("button", { name: "No, no me sirve", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Motivo")).toHaveValue("el score está alto");

    const fila = await evaluationFeedbackOf(detalle);
    expect(fila?.humanVerdict).toBe("en_desacuerdo");
    expect(fila?.humanVerdictAt).not.toBeNull();
    expect(fila?.humanNote).toBe("el score está alto");
  });

  test("el score numérico no pisa el veredicto ni la nota", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${detalle}`);
    await page.getByText("Corregir el puntaje").click();
    await page.getByLabel("Score humano (0–10)").fill("6");
    await expect(page.getByLabel("Nota")).toHaveValue("el score está alto");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(detalle))?.humanScore).toBe(6);

    const fila = await evaluationFeedbackOf(detalle);
    expect(fila?.humanVerdict).toBe("en_desacuerdo");
    expect(fila?.humanNote).toBe("el score está alto");
  });

  test("volver a tocar 'No' lo quita", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${detalle}`);
    const no = page
      .getByRole("group", { name: "¿Te sirve esta evaluación?" })
      .getByRole("button", { name: "No, no me sirve", exact: true });
    await expect(no).toHaveAttribute("aria-pressed", "true");
    await no.click();
    await expect(no).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await evaluationFeedbackOf(detalle))?.humanVerdict).toBeNull();
  });

  test("tarjeta: 'Me sirve la evaluación' no navega y queda guardado", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    const item = page.getByRole("main").getByRole("listitem").filter({ hasText: tituloTarjeta });
    const boton = item.getByRole("button", { name: "Me sirve la evaluación", exact: true });
    await expect(boton).toHaveAttribute("aria-pressed", "false");
    await boton.click();
    await expect(boton).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/jobs(\?.*)?$/);
    await expect
      .poll(async () => (await evaluationFeedbackOf(tarjeta))?.humanVerdict)
      .toBe("de_acuerdo");
  });
});
