import { expect, test } from "@playwright/test";
import { createInboundEmail, deleteInboundEmails, inboundState, login } from "./helpers";

/**
 * Flujo 12 (JS-039): el email se lee como en un cliente de correo (un solo cuerpo, no texto y
 * HTML en bloques separados) y tiene arriba las mismas acciones que la lista de /inbox.
 */
test.describe("Flujo 12: vista de email unificada con acciones arriba", () => {
  const tag = Date.now();

  test.afterAll(async () => {
    await deleteInboundEmails(String(tag));
  });

  test("HTML en un solo cuerpo aislado, acciones arriba, visto y eliminar desde el detalle", async ({
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

    // Marcar visto desde el detalle: se queda en el detalle y cambia a "Volver a pendientes"
    await acciones.getByRole("button", { name: "Marcar visto" }).click();
    await expect(acciones.getByRole("button", { name: "Volver a pendientes" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/inbox/${email.id}`));
    expect((await inboundState(email.id, email.rawRef)).row?.seenAt).not.toBeNull();

    // Eliminar desde el detalle: confirma y vuelve a /inbox
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
});
