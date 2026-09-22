import { expect, test } from "@playwright/test";
import {
  clearSenderVerdicts,
  createInboundEmail,
  deleteInboundEmails,
  inboundState,
  login,
  senderVerdict,
} from "./helpers";

/**
 * Flujo 12 (JS-039): el email se lee como en un cliente de correo (un solo cuerpo, no texto y
 * HTML en bloques separados) y tiene arriba las mismas acciones que la lista de /inbox.
 */
test.describe("Flujo 12: vista de email unificada con acciones arriba", () => {
  const tag = Date.now();

  test.afterAll(async () => {
    await deleteInboundEmails(String(tag));
    await clearSenderVerdicts(String(tag));
  });

  test("HTML en un solo cuerpo aislado, acciones arriba, visto al abrir y eliminar desde el detalle", async ({
    page,
  }) => {
    const email = await createInboundEmail({
      subject: `E2E detalle ${tag}`,
      from: "Alertas E2E <alertas@example.com>",
      html: `<table width="600"><tr><td><h2>Nueva oferta ${tag}</h2><a href="https://example.com/oferta">Ver oferta</a></td></tr></table>`,
      text: `Nueva oferta ${tag}\nhttps://example.com/oferta`,
    });
    await login(page);
    await page.goto(`/inbox/${email.id}`);

    await expect(page.getByRole("heading", { name: `E2E detalle ${tag}` })).toBeVisible();
    await expect(page.getByText("Alertas E2E <alertas@example.com>")).toBeVisible();

    // Un solo cuerpo: el HTML en un iframe con sandbox vacío (nunca inyectado en la página)
    const cuerpo = page.locator('iframe[title="Contenido del email"]');
    await expect(cuerpo).toHaveCount(1);
    await expect(cuerpo).toHaveAttribute("sandbox", "");
    await expect(
      page.frameLocator('iframe[title="Contenido del email"]').getByRole("heading"),
    ).toContainText(`Nueva oferta ${tag}`);
    // El texto plano no es otro bloque visible: queda como alternativa plegada
    const plano = page.getByText("Ver como texto plano");
    await expect(plano).toBeVisible();
    await expect(page.getByText(`https://example.com/oferta`, { exact: true })).toBeHidden();

    // Las acciones van arriba del cuerpo
    const acciones = page.getByRole("group", { name: "Acciones del email" });
    const yAcciones = (await acciones.boundingBox())!.y;
    const yCuerpo = (await cuerpo.boundingBox())!.y;
    expect(yAcciones).toBeLessThan(yCuerpo);

    // Abrirlo lo marcó visto: sale de pendientes; "No me sirve" sigue disponible
    await expect(acciones.getByRole("button", { name: "Volver a pendientes" })).toBeVisible();
    await expect(acciones.getByRole("button", { name: "No me sirve" })).toBeVisible();
    expect((await inboundState(email.id, email.rawRef)).row?.seenAt).not.toBeNull();

    // Volver a pendientes desde el detalle: vuelve a la lista (quedarse lo remarcaría visto)
    await acciones.getByRole("button", { name: "Volver a pendientes" }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    expect((await inboundState(email.id, email.rawRef)).row?.seenAt).toBeNull();

    // Eliminar desde el detalle: confirma y vuelve a /inbox
    await page.goto(`/inbox/${email.id}`);
    page.once("dialog", (d) => d.accept());
    await acciones.getByRole("button", { name: "Eliminar" }).click();
    await expect(page).toHaveURL(/\/inbox$/);
    expect((await inboundState(email.id, email.rawRef)).row).toBeNull();
  });

  test("un email sin HTML muestra el texto como cuerpo", async ({ page }) => {
    const email = await createInboundEmail({
      subject: `E2E solo texto ${tag}`,
      text: `Hola, este email vino solo en texto ${tag}.`,
      html: null,
    });
    await login(page);
    await page.goto(`/inbox/${email.id}`);
    await expect(page.locator('iframe[title="Contenido del email"]')).toHaveCount(0);
    await expect(page.getByText(`Hola, este email vino solo en texto ${tag}.`)).toBeVisible();
  });

  test("abrir un email descartado no lo marca visto", async ({ page }) => {
    const subject = `E2E descartado ${tag}`;
    const email = await createInboundEmail({ subject, text: "x" });
    await login(page);
    await page.goto("/inbox");
    await page
      .getByRole("listitem")
      .filter({ hasText: subject })
      .getByRole("button", { name: "No me sirve" })
      .click();
    await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);

    await page.goto(`/inbox/${email.id}`);
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
    const row = (await inboundState(email.id, email.rawRef)).row;
    expect(row?.dismissedAt).not.toBeNull();
    expect(row?.seenAt).toBeNull();
  });

  test("remitente no esperado: explica que no se guardó el cuerpo y deja marcar el dominio como fuente de empleo (JS-051)", async ({
    page,
  }) => {
    const dominio = `reclutadora-${tag}.example`;
    const email = await createInboundEmail({
      subject: `E2E sin cuerpo ${tag}`,
      from: `Talento <talento@mail.${dominio}>`,
      redacted: true,
      error:
        "remitente no esperado: por privacidad se guardó solo remitente, asunto y fecha, sin el cuerpo",
    });
    await login(page);
    await page.goto(`/inbox/${email.id}`);
    await expect(page.getByRole("heading", { name: `E2E sin cuerpo ${tag}` })).toBeVisible();
    const aviso = page.getByRole("region", { name: "Cuerpo no guardado" });
    await expect(aviso).toContainText("Por privacidad no se guardó el cuerpo");
    await expect(page.locator('iframe[title="Contenido del email"]')).toHaveCount(0);

    await aviso.getByRole("button", { name: `Marcar ${dominio} como fuente de empleo` }).click();
    await expect(aviso).toContainText(`Los próximos emails de ${dominio} se guardan completos`);
    expect(await senderVerdict(dominio)).toBe("empleo");
  });
});
