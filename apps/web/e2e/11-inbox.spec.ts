import { expect, test, type Page } from "@playwright/test";
import {
  addInboundRejections,
  clearInboundRejections,
  createInboundEmail,
  createJob,
  deleteInboundEmails,
  deleteJob,
  inboundState,
  linkJobToRaw,
  login,
} from "./helpers";

/**
 * Flujo 11 (JS-038): acciones por email en /inbox y aviso de volumen. Visto y "no me sirve"
 * sacan el email de la vista por defecto sin borrarlo; solo "Eliminar" borra.
 */
test.describe("Flujo 11: acciones y volumen en /inbox", () => {
  const tag = Date.now();
  const fila = (page: Page, subject: string) =>
    page.getByRole("main").getByRole("listitem").filter({ hasText: subject });
  // Las pestañas de /inbox (el menú principal también tiene "Pendientes de JD")
  const pestaña = (page: Page, nombre: string) =>
    page
      .getByRole("navigation", { name: "Vistas" })
      .getByRole("link", { name: new RegExp(`^${nombre}`) });
  // Next.js agrega su propio anunciador de rutas con role="alert": el aviso se busca en <main>
  const aviso = (page: Page) =>
    page.getByRole("main").getByRole("alert", { name: "Volumen fuera de lo normal" });

  test.afterAll(async () => {
    await clearInboundRejections();
    // Los emails de prueba se van: si se acumularan, dispararían el aviso de volumen
    await deleteInboundEmails(String(tag));
  });

  test("visto, no me sirve, volver a pendientes y eliminar (con y sin avisos que dependan del crudo)", async ({
    page,
  }) => {
    const visto = await createInboundEmail({ subject: `E2E visto ${tag}` });
    const noSirve = await createInboundEmail({ subject: `E2E no sirve ${tag}` });
    const borrar = await createInboundEmail({ subject: `E2E borrar ${tag}` });
    const conAviso = await createInboundEmail({ subject: `E2E con aviso ${tag}` });
    const jobId = await createJob({ title: `E2E aviso del email ${tag}`, status: "evaluada" });
    await linkJobToRaw(jobId, conAviso.rawRef);

    await login(page);
    await page.goto("/inbox");
    for (const sub of ["visto", "no sirve", "borrar", "con aviso"])
      await expect(fila(page, `E2E ${sub} ${tag}`)).toBeVisible();

    // Marcar visto: sale de pendientes, queda en "Vistos"
    await fila(page, `E2E visto ${tag}`).getByRole("button", { name: "Marcar visto" }).click();
    await expect(fila(page, `E2E visto ${tag}`)).toHaveCount(0);
    expect((await inboundState(visto.id, visto.rawRef)).row?.seenAt).not.toBeNull();

    // No me sirve: sale de pendientes, queda en "Descartados" y se puede volver atrás
    await fila(page, `E2E no sirve ${tag}`).getByRole("button", { name: "No me sirve" }).click();
    await expect(fila(page, `E2E no sirve ${tag}`)).toHaveCount(0);
    await pestaña(page, "Descartados").click();
    await expect(fila(page, `E2E no sirve ${tag}`)).toBeVisible();
    await fila(page, `E2E no sirve ${tag}`)
      .getByRole("button", { name: "Volver a pendientes" })
      .click();
    await expect(fila(page, `E2E no sirve ${tag}`)).toHaveCount(0);
    await pestaña(page, "Pendientes").click();
    await expect(fila(page, `E2E no sirve ${tag}`)).toBeVisible();
    expect((await inboundState(noSirve.id, noSirve.rawRef)).row?.dismissedAt).toBeNull();

    // En "Vistos" está el que marqué
    await pestaña(page, "Vistos").click();
    await expect(fila(page, `E2E visto ${tag}`)).toBeVisible();
    await pestaña(page, "Pendientes").click();

    // Eliminar pide confirmación; cancelar no borra
    page.once("dialog", (d) => d.dismiss());
    await fila(page, `E2E borrar ${tag}`).getByRole("button", { name: "Eliminar" }).click();
    await expect(fila(page, `E2E borrar ${tag}`)).toBeVisible();
    expect((await inboundState(borrar.id, borrar.rawRef)).row).not.toBeNull();

    // Aceptar: se borra la fila y el crudo (ningún aviso lo usa)
    page.once("dialog", (d) => d.accept());
    await fila(page, `E2E borrar ${tag}`).getByRole("button", { name: "Eliminar" }).click();
    await expect(fila(page, `E2E borrar ${tag}`)).toHaveCount(0);
    expect(await inboundState(borrar.id, borrar.rawRef)).toEqual({ row: null, blob: false });

    // Con un aviso que usa su crudo como fuente (JS-024): se borra la fila, el crudo queda
    page.once("dialog", (d) => d.accept());
    await fila(page, `E2E con aviso ${tag}`).getByRole("button", { name: "Eliminar" }).click();
    await expect(fila(page, `E2E con aviso ${tag}`)).toHaveCount(0);
    expect(await inboundState(conAviso.id, conAviso.rawRef)).toEqual({ row: null, blob: true });

    await deleteJob(jobId);
  });

  test("muestra el volumen de 24 h y avisa si hubo emails rechazados por el límite", async ({
    page,
  }) => {
    await clearInboundRejections();
    await login(page);
    await page.goto("/inbox");
    await expect(page.getByText(/en 24 h/)).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);

    await addInboundRejections(3);
    await page.reload();
    await expect(aviso(page)).toContainText("3 emails rechazados por el límite");
  });

  test("el ruido social de LinkedIn llega a Descartados como «no relevante», sin «cargar a mano» (JS-050)", async ({
    page,
  }) => {
    await createInboundEmail({
      subject: `E2E social ${tag}`,
      from: "LinkedIn <messages-noreply@linkedin.com>",
      parser: "linkedin_social",
      error: null,
      dismissed: true,
    });
    await login(page);
    await page.goto("/inbox");
    await expect(fila(page, `E2E social ${tag}`)).toHaveCount(0);
    await pestaña(page, "Descartados").click();
    const row = fila(page, `E2E social ${tag}`);
    await expect(row).toContainText("no relevante: notificación social de LinkedIn");
    await expect(row).not.toContainText("parser linkedin_social");
    await expect(row.getByRole("link", { name: "cargar a mano" })).toHaveCount(0);
    // Se puede recuperar como cualquier descartado
    await expect(row.getByRole("button", { name: "Volver a pendientes" })).toBeVisible();
  });
});
