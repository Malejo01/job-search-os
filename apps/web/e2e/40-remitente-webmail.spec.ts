import { expect, test } from "@playwright/test";
import { createInboundEmail, deleteInboundEmails, login, senderVerdict } from "./helpers";

/**
 * Flujo 40 (ronda 58, RM-3): un dominio de correo personal (webmail) nunca se ofrece como fuente
 * de empleo, ni en el aviso de fuga, ni en el detalle de un email sin cuerpo, ni en Ajustes ›
 * Remitentes. "No es de empleo" y "Sin decidir" siguen disponibles. Datos inventados, sin red.
 */
test.describe("Flujo 40: remitente de webmail", () => {
  const tag = Date.now();
  const WEBMAIL = "gmail.com";
  const MENSAJE = "es un proveedor de correo personal";
  const LINEA = "Correo personal: no se puede marcar como fuente";

  test.afterAll(async () => {
    await deleteInboundEmails(String(tag));
  });

  test("el detalle de un email sin cuerpo de webmail no ofrece marcarlo como fuente", async ({
    page,
  }) => {
    const mail = await createInboundEmail({
      subject: `E2E webmail detalle ${tag}`,
      from: `Persona A <persona.a.${tag}@${WEBMAIL}>`,
      redacted: true,
    });
    await login(page);
    await page.goto(`/inbox/${mail.id}`);

    const seccion = page.getByRole("region", { name: "Cuerpo no guardado" });
    await expect(seccion).toContainText(LINEA);
    await expect(
      seccion.getByRole("button", { name: /Marcar .* como fuente de empleo/ }),
    ).toHaveCount(0);
    expect(await senderVerdict(WEBMAIL)).toBeNull();
  });

  test("Ajustes › Remitentes: sin la opción «Es de empleo» para webmail, y sí para un dominio propio", async ({
    page,
  }) => {
    await createInboundEmail({
      subject: `E2E webmail ajustes ${tag}`,
      from: `Persona B <persona.b.${tag}@${WEBMAIL}>`,
      redacted: true,
    });
    await createInboundEmail({
      subject: `E2E dominio propio ${tag}`,
      from: `Alertas <aviso@ejemplo-remitente-${tag}.example>`,
      redacted: true,
    });
    await login(page);
    await page.goto("/settings/senders");

    const fila = page.getByRole("listitem").filter({ hasText: WEBMAIL });
    await expect(fila).toContainText(LINEA);
    await expect(fila.getByRole("button", { name: "Es de empleo", exact: true })).toHaveCount(0);
    await expect(fila.getByRole("button", { name: "No es de empleo" })).toBeVisible();
    await expect(fila.getByRole("button", { name: "Sin decidir" })).toBeVisible();

    const propia = page
      .getByRole("listitem")
      .filter({ hasText: `ejemplo-remitente-${tag}.example` });
    await expect(propia.getByRole("button", { name: "Es de empleo", exact: true })).toBeVisible();

    // «No es de empleo» sobre webmail sí se permite; «Sin decidir» lo borra
    await fila.getByRole("button", { name: "No es de empleo" }).click();
    await expect(fila.getByRole("button", { name: "No es de empleo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await senderVerdict(WEBMAIL)).toBe("no_empleo");
    await fila.getByRole("button", { name: "Sin decidir" }).click();
    await expect(fila.getByRole("button", { name: "Sin decidir" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await senderVerdict(WEBMAIL)).toBeNull();
  });

  test("el mensaje de rechazo se muestra en las tres pantallas y no escribe nada", async ({
    page,
  }) => {
    const mail = await createInboundEmail({
      subject: `E2E webmail rechazo ${tag}`,
      from: `Persona C <persona.c.${tag}@${WEBMAIL}>`,
      redacted: true,
    });
    await login(page);
    for (const ruta of ["/inbox", `/inbox/${mail.id}`, "/settings/senders"]) {
      await page.goto(`${ruta}?error=webmail&sender=${WEBMAIL}`);
      const aviso = page.getByTestId("error-webmail");
      await expect(aviso).toContainText(`No se puede marcar ${WEBMAIL} como fuente de empleo`);
      await expect(aviso).toContainText(MENSAJE);
      await expect(aviso).toContainText("filtro de reenvío automático");
    }
    // Un dominio que no es webmail no dispara el mensaje (no se puede forzar con la URL)
    await page.goto(`/inbox?error=webmail&sender=empresa-a.example`);
    await expect(page.getByTestId("error-webmail")).toHaveCount(0);
    expect(await senderVerdict(WEBMAIL)).toBeNull();
  });
});
