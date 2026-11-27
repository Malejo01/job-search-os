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
    await page.getByRole("button", { name: "Falta algo importante" }).click();
    await page.getByRole("button", { name: "Guardar motivo" }).click();
    await expect
      .poll(async () => (await evaluationFeedbackOf(mismo))?.humanNote)
      .toBe("Falta algo importante");

    // Sin page.goto: el formulario numérico se remonta con la nota nueva al revalidar
    await page.getByText("Proponer otro puntaje").click();
    await expect(page.getByLabel("Nota")).toHaveValue("Falta algo importante");
    await page.getByLabel("Tu puntaje (0–10)").fill("6");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(mismo))?.humanScore).toBe(6);
    const fila = await evaluationFeedbackOf(mismo);
    expect(fila?.humanNote).toBe("Falta algo importante");
    expect(fila?.humanVerdict).toBe("en_desacuerdo");
    // Sin recargar: el formulario se remonta y muestra lo guardado
    await expect(page.getByLabel("Tu puntaje (0–10)")).toHaveValue("6");
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
    const campo = page.getByLabel("Contanos más (opcional)", { exact: true });
    await expect(guardar).toBeDisabled(); // vacío
    await page.getByRole("button", { name: "Falta algo importante", exact: true }).click();
    await expect(guardar).toBeEnabled();
    await guardar.click();

    // Sin page.goto: el campo sigue mostrando el texto y aparece la confirmación
    await expect(page.getByRole("status").filter({ hasText: "Guardado ✓" })).toBeVisible();
    await expect(campo).toHaveValue("Falta algo importante");
    await expect(guardar).toBeDisabled(); // igual al guardado
    await expect
      .poll(async () => (await evaluationFeedbackOf(motivo))?.humanNote)
      .toBe("Falta algo importante");

    await page.reload();
    await expect(campo).toHaveValue("Falta algo importante");

    await page.getByRole("button", { name: "Quitar motivo", exact: true }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(motivo))?.humanNote).toBeNull();
    await expect(campo).toHaveValue("");
    await expect(page.getByRole("button", { name: "Quitar motivo", exact: true })).toHaveCount(0);
  });

  test("tarjeta en 360 px: sin scroll horizontal y sin 👍/👎 (van en el detalle, C10-7)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await login(page);
    await page.goto("/jobs");
    const item = page.getByRole("main").getByRole("listitem").filter({ hasText: tituloTarjeta });
    await expect(item).toBeVisible();
    // La tarjeta de R30-04 trae «Guardar» y «Descartar» (job-list.tsx): eso es el diseño, no un fallo. Lo que este
    // flujo exige es que el 👍/👎 NO esté en la tarjeta (va en el detalle, C10-7): se busca ese par y los
    // botones de la tarjeta solo pueden ser esos dos.
    await expect(item.getByRole("button", { name: /me sirve la evaluación/i })).toHaveCount(0);
    await expect(item.getByText(/👍|👎/)).toHaveCount(0);
    const botones = await item.getByRole("button").allInnerTexts();
    expect(botones.every((t) => /^(Guardar|Quitar|Descartar)/i.test(t.trim()))).toBe(true);
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

    await page.getByRole("button", { name: "El puntaje no me parece justo" }).click();
    await expect(page.getByLabel("Contanos más (opcional)")).toHaveValue(
      "El puntaje no me parece justo",
    );
    await page.getByRole("button", { name: "Guardar motivo" }).click();
    // Recargar recién con la nota en la base: si no, la recarga le gana a la acción en curso
    await expect
      .poll(async () => (await evaluationFeedbackOf(detalle))?.humanNote)
      .toBe("El puntaje no me parece justo");

    await page.reload();
    await expect(
      page
        .getByRole("group", { name: "¿Te sirve esta evaluación?" })
        .getByRole("button", { name: "No, no me sirve", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Contanos más (opcional)")).toHaveValue(
      "El puntaje no me parece justo",
    );

    const fila = await evaluationFeedbackOf(detalle);
    expect(fila?.humanVerdict).toBe("en_desacuerdo");
    expect(fila?.humanVerdictAt).not.toBeNull();
    expect(fila?.humanNote).toBe("El puntaje no me parece justo");
  });

  test("el score numérico no pisa el veredicto ni la nota", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${detalle}`);
    await page.getByText("Proponer otro puntaje").click();
    await page.getByLabel("Tu puntaje (0–10)").fill("6");
    await expect(page.getByLabel("Nota")).toHaveValue("El puntaje no me parece justo");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect.poll(async () => (await evaluationFeedbackOf(detalle))?.humanScore).toBe(6);

    const fila2 = await evaluationFeedbackOf(detalle);
    expect(fila2?.humanVerdict).toBe("en_desacuerdo");
    expect(fila2?.humanNote).toBe("El puntaje no me parece justo");
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

  test("tarjeta: lleva al detalle, donde está «¿Te sirve esta evaluación?» y queda guardado", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const item = page.getByRole("main").getByRole("listitem").filter({ hasText: tituloTarjeta });
    await item.getByRole("link", { name: /abrir el detalle/i }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${tarjeta}`));
    const si = page
      .getByRole("group", { name: "¿Te sirve esta evaluación?" })
      .getByRole("button", { name: "Sí, me sirve", exact: true });
    await si.click();
    await expect(si).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await evaluationFeedbackOf(tarjeta))?.humanVerdict)
      .toBe("de_acuerdo");
  });
});
