import { expect, test, type Page } from "@playwright/test";
import {
  createInboundEmail,
  createJob,
  deleteInboundEmails,
  deleteJob,
  inboundState,
  linkJobToRaw,
  login,
} from "./helpers";

/**
 * Flujo 13 (JS-049): selección múltiple en /inbox para limpiar en lote (el filtro de Gmail
 * dejó pasar banco, streaming, GitHub…). Checkbox por fila, barra de acciones cuando hay algo
 * seleccionado, una sola confirmación para eliminar y "seleccionar todos" de la pestaña actual.
 */
test.describe("Flujo 13: selección múltiple en /inbox", () => {
  const tag = Date.now();
  const main = (page: Page) => page.getByRole("main");
  const fila = (page: Page, subject: string) =>
    main(page).getByRole("listitem").filter({ hasText: subject });
  const casilla = (page: Page, subject: string) =>
    fila(page, subject).getByRole("checkbox", { name: /^Seleccionar «/ });
  const barra = (page: Page) => page.getByRole("toolbar", { name: "Acciones en lote" });
  const pestaña = (page: Page, nombre: string) =>
    page
      .getByRole("navigation", { name: "Vistas" })
      .getByRole("link", { name: new RegExp(`^${nombre}`) });

  test.afterAll(async () => {
    await deleteInboundEmails(String(tag));
  });

  test("marcar visto y «no me sirve» en lote", async ({ page }) => {
    const a = await createInboundEmail({ subject: `E2E lote A ${tag}` });
    const b = await createInboundEmail({ subject: `E2E lote B ${tag}` });
    const c = await createInboundEmail({ subject: `E2E lote C ${tag}` });
    await login(page);
    await page.goto("/inbox");

    // Sin selección no hay barra de acciones
    await expect(barra(page)).toHaveCount(0);
    await casilla(page, `E2E lote A ${tag}`).check();
    await casilla(page, `E2E lote B ${tag}`).check();
    await expect(barra(page)).toContainText("2 seleccionados");

    await barra(page).getByRole("button", { name: "Marcar visto" }).click();
    await expect(fila(page, `E2E lote A ${tag}`)).toHaveCount(0);
    await expect(fila(page, `E2E lote B ${tag}`)).toHaveCount(0);
    await expect(fila(page, `E2E lote C ${tag}`)).toBeVisible();
    // Después de actuar, la selección se limpia
    await expect(barra(page)).toHaveCount(0);
    expect((await inboundState(a.id, a.rawRef)).row?.seenAt).not.toBeNull();
    expect((await inboundState(b.id, b.rawRef)).row?.seenAt).not.toBeNull();
    expect((await inboundState(c.id, c.rawRef)).row?.seenAt).toBeNull();

    // "No me sirve" en lote desde la pestaña Vistos: no borra nada
    await pestaña(page, "Vistos").click();
    await casilla(page, `E2E lote A ${tag}`).check();
    await casilla(page, `E2E lote B ${tag}`).check();
    await barra(page).getByRole("button", { name: "No me sirve" }).click();
    await expect(fila(page, `E2E lote A ${tag}`)).toHaveCount(0);
    const stA = await inboundState(a.id, a.rawRef);
    expect(stA.row?.dismissedAt).not.toBeNull();
    expect(stA.blob).toBe(true);
  });

  test("eliminar en lote con una sola confirmación que dice cuántos", async ({ page }) => {
    const x = await createInboundEmail({ subject: `E2E borrar lote X ${tag}` });
    const y = await createInboundEmail({ subject: `E2E borrar lote Y ${tag}` });
    const conAviso = await createInboundEmail({ subject: `E2E borrar lote aviso ${tag}` });
    const jobId = await createJob({ title: `E2E aviso lote ${tag}`, status: "evaluada" });
    await linkJobToRaw(jobId, conAviso.rawRef);
    await login(page);
    await page.goto("/inbox");

    for (const s of ["X", "Y", "aviso"]) await casilla(page, `E2E borrar lote ${s} ${tag}`).check();

    // Cancelar no borra nada
    const dialogs: string[] = [];
    page.once("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await barra(page).getByRole("button", { name: "Eliminar" }).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/¿Eliminar 3 emails\?/);
    expect((await inboundState(x.id, x.rawRef)).row).not.toBeNull();

    // Aceptar: una sola confirmación para los tres
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.accept();
    });
    await barra(page).getByRole("button", { name: "Eliminar" }).click();
    await expect(fila(page, `E2E borrar lote X ${tag}`)).toHaveCount(0);
    await expect(fila(page, `E2E borrar lote aviso ${tag}`)).toHaveCount(0);
    expect(dialogs).toHaveLength(2);
    expect(await inboundState(x.id, x.rawRef)).toEqual({ row: null, blob: false });
    expect(await inboundState(y.id, y.rawRef)).toEqual({ row: null, blob: false });
    // El crudo que usa un aviso como fuente se conserva, igual que al borrar de a uno
    expect(await inboundState(conAviso.id, conAviso.rawRef)).toEqual({ row: null, blob: true });
    await deleteJob(jobId);
  });

  test("seleccionar todos marca solo las filas de la pestaña actual", async ({ page }) => {
    await createInboundEmail({ subject: `E2E todos pendiente ${tag}` });
    await createInboundEmail({ subject: `E2E todos descartado ${tag}` });
    await login(page);
    await page.goto("/inbox");
    // uno pasa a Descartados, el otro queda en Pendientes
    await fila(page, `E2E todos descartado ${tag}`)
      .getByRole("button", { name: "No me sirve" })
      .click();
    await expect(fila(page, `E2E todos descartado ${tag}`)).toHaveCount(0);

    const todas = main(page).getByRole("checkbox", { name: /^Seleccionar «/ });
    const n = await todas.count();
    expect(n).toBeGreaterThan(0);
    await main(page).getByRole("checkbox", { name: "Seleccionar todos" }).check();
    await expect(barra(page)).toContainText(`${n} seleccionado`);
    for (let i = 0; i < n; i++) await expect(todas.nth(i)).toBeChecked();
    await expect(casilla(page, `E2E todos pendiente ${tag}`)).toBeChecked();

    // Destildar "todos" limpia la selección sin tocar nada
    await main(page).getByRole("checkbox", { name: "Seleccionar todos" }).uncheck();
    await expect(barra(page)).toHaveCount(0);

    // En Descartados, "todos" es lo de esa pestaña: está el descartado y no el pendiente
    await pestaña(page, "Descartados").click();
    await expect(fila(page, `E2E todos descartado ${tag}`)).toBeVisible();
    const enDescartados = await todas.count();
    await main(page).getByRole("checkbox", { name: "Seleccionar todos" }).check();
    await expect(barra(page)).toContainText(`${enDescartados} seleccionado`);
    await expect(casilla(page, `E2E todos descartado ${tag}`)).toBeChecked();
    await expect(fila(page, `E2E todos pendiente ${tag}`)).toHaveCount(0);
  });
});
