import { expect, test, type Page } from "@playwright/test";
import {
  clearSenderVerdicts,
  createInboundEmail,
  deleteInboundEmails,
  inboundState,
  login,
  senderVerdict,
  setSenderVerdictForSeed,
} from "./helpers";

/**
 * Flujo 21 (ronda 19, bandeja automática): "Pendientes" solo muestra lo que necesita
 * intervención, la confirmación de reenvío de Gmail va arriba de todo, las acciones en lote
 * viajan por id con "Deshacer" y Ajustes › Remitentes cambia la decisión sobre un dominio.
 * Todo con datos inventados y sin red.
 */
test.describe("Flujo 21: bandeja automática", () => {
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
  const dominioGmail = `ejemplo-remitente-${tag}.example`;

  test.afterAll(async () => {
    await deleteInboundEmails(String(tag));
    await clearSenderVerdicts(String(tag));
  });

  test("Pendientes no muestra un email con avisos extraídos y sí uno de la cola manual", async ({
    page,
  }) => {
    await createInboundEmail({
      subject: `E2E con avisos ${tag}`,
      parser: "linkedin",
      error: null,
      jobsExtracted: 2,
    });
    await createInboundEmail({ subject: `E2E cola manual ${tag}` });
    await login(page);
    await page.goto("/inbox");
    await expect(fila(page, `E2E cola manual ${tag}`)).toBeVisible();
    await expect(fila(page, `E2E con avisos ${tag}`)).toHaveCount(0);

    // El de avisos sigue en la base: está en «Todos»
    await pestaña(page, "Todos").click();
    await expect(fila(page, `E2E con avisos ${tag}`)).toBeVisible();
  });

  test("lote por id: marcar visto sobre 2, Deshacer los devuelve; volver a pendientes desde Descartados", async ({
    page,
  }) => {
    const a = await createInboundEmail({ subject: `E2E lote A ${tag}` });
    const b = await createInboundEmail({ subject: `E2E lote B ${tag}` });
    const c = await createInboundEmail({ subject: `E2E lote C ${tag}` });
    const d = await createInboundEmail({ subject: `E2E lote D ${tag}`, dismissed: true });
    await login(page);
    await page.goto("/inbox");

    await casilla(page, `E2E lote A ${tag}`).check();
    await casilla(page, `E2E lote B ${tag}`).check();
    await expect(barra(page)).toContainText("2 seleccionados");
    await barra(page).getByRole("button", { name: "Marcar visto" }).click();

    const aviso = page.getByRole("status");
    await expect(aviso).toContainText("2 emails marcados como vistos");
    await expect(fila(page, `E2E lote A ${tag}`)).toHaveCount(0);
    expect((await inboundState(a.id, a.rawRef)).row?.seenAt).not.toBeNull();
    expect((await inboundState(b.id, b.rawRef)).row?.seenAt).not.toBeNull();
    // Solo los dos elegidos: C y D no se tocaron
    expect((await inboundState(c.id, c.rawRef)).row?.seenAt).toBeNull();
    expect((await inboundState(d.id, d.rawRef)).row?.seenAt).toBeNull();

    await aviso.getByRole("button", { name: "Deshacer" }).click();
    await expect(fila(page, `E2E lote A ${tag}`)).toBeVisible();
    await expect(fila(page, `E2E lote B ${tag}`)).toBeVisible();
    await expect(aviso.getByRole("button", { name: "Deshacer" })).toHaveCount(0);
    expect((await inboundState(a.id, a.rawRef)).row?.seenAt).toBeNull();
    expect((await inboundState(b.id, b.rawRef)).row?.seenAt).toBeNull();

    // Descartados: «Volver a pendientes» en lote
    await pestaña(page, "Descartados").click();
    await casilla(page, `E2E lote D ${tag}`).check();
    await barra(page).getByRole("button", { name: "Volver a pendientes" }).click();
    await expect(fila(page, `E2E lote D ${tag}`)).toHaveCount(0);
    expect((await inboundState(d.id, d.rawRef)).row?.dismissedAt).toBeNull();
    await pestaña(page, "Pendientes").click();
    await expect(fila(page, `E2E lote D ${tag}`)).toBeVisible();
  });

  test("la confirmación de Gmail aparece arriba con el botón hacia mail.google.com", async ({
    page,
  }) => {
    const gmail = await createInboundEmail({
      subject: `E2E reenvío de Gmail ${tag}`,
      from: "Equipo de reenvíos <reenvios@example.com>",
      parser: "gmail_reenvio",
      error: null,
      text: "persona.a@example.com has requested to automatically forward mail to your email address. Confirmá el reenvío: https://mail.google.com/mail/vf-ejemplo-123?c=abc",
    });
    await login(page);
    await page.goto("/inbox");

    const bloque = main(page).getByRole("region", { name: "Confirmación del reenvío de Gmail" });
    await expect(bloque).toContainText("Confirmá el reenvío de Gmail");
    await expect(bloque).toContainText("persona.a@example.com");
    await expect(bloque).toContainText("Confirmá solo si es tu cuenta de Gmail");
    const boton = bloque.getByRole("link", { name: "Confirmar reenvío" });
    const href = (await boton.getAttribute("href")) ?? "";
    expect(new URL(href).host).toBe("mail.google.com");
    await expect(boton).toHaveAttribute("target", "_blank");
    await expect(boton).toHaveAttribute("rel", /noopener/);

    // Es lo primero de la página
    const primero = await main(page).locator("section > *").first().getAttribute("aria-label");
    expect(primero).toBe("Confirmación del reenvío de Gmail");

    await bloque.getByRole("button", { name: "Ya lo confirmé" }).click();
    await expect(bloque).toHaveCount(0);
    expect((await inboundState(gmail.id, gmail.rawRef)).row?.seenAt).not.toBeNull();
  });

  test("Ajustes › Remitentes: pasar un dominio a «sin decidir»", async ({ page }) => {
    await setSenderVerdictForSeed(dominioGmail, "empleo");
    await createInboundEmail({
      subject: `E2E remitente ${tag}`,
      from: `Alertas <aviso@${dominioGmail}>`,
    });
    await login(page);
    await page.goto("/settings/senders");

    await expect(page.getByTestId("aviso-empleo")).toContainText(
      "Los emails de los dominios marcados como empleo se guardan completos",
    );
    const fila = page.getByRole("listitem").filter({ hasText: dominioGmail });
    await expect(fila).toContainText("1 email");
    await expect(fila.getByRole("button", { name: "Es de empleo", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await fila.getByRole("button", { name: "Sin decidir" }).click();
    await expect(fila.getByRole("button", { name: "Sin decidir" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await senderVerdict(dominioGmail)).toBeNull();
  });
});
