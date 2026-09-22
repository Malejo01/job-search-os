import { expect, test, type Page } from "@playwright/test";
import {
  clearSenderVerdicts,
  createInboundEmail,
  deleteInboundEmails,
  inboundState,
  login,
  senderVerdict,
} from "./helpers";

/**
 * Flujo 15 (JS-048): aviso de "posible fuga del filtro de reenvío". Salta con un solo email de
 * un dominio nunca visto que no es fuente de empleo; se resuelve marcándolo o borrando todos los
 * emails de ese dominio de una vez. Es la señal que habría mostrado el 2026-09-18 el primer
 * email del banco.
 */
test.describe("Flujo 15: posible fuga del filtro", () => {
  const tag = Date.now();
  const banco = `banco-e2e-${tag}.com.ar`;
  const cursos = `cursos-e2e-${tag}.org`;
  const streaming = `netflixe2e${tag}.com`;
  const viejo = `viejo-e2e-${tag}.com`;

  const aviso = (page: Page) =>
    page.getByRole("main").getByRole("alert", { name: "Posible fuga del filtro de reenvío" });
  const dominio = (page: Page, d: string) =>
    aviso(page).getByRole("listitem").filter({ hasText: d });

  test.afterAll(async () => {
    await deleteInboundEmails(String(tag));
    await clearSenderVerdicts(String(tag));
  });

  test("un dominio nuevo de banco avisa con su etiqueta; «eliminar todos» borra sus emails de una vez", async ({
    page,
  }) => {
    const a = await createInboundEmail({
      subject: `E2E banco 1 ${tag}`,
      from: `Banco <avisos@mails.${banco}>`,
    });
    const b = await createInboundEmail({
      subject: `E2E banco 2 ${tag}`,
      from: `Banco <info@comunicaciones.${banco}>`,
    });
    await login(page);
    await page.goto("/inbox");

    const fila = dominio(page, banco);
    // la etiqueta, no el nombre del dominio (que también dice "banco")
    await expect(fila.getByText("banco", { exact: true })).toBeVisible();
    await expect(fila).toContainText("2 emails");

    // "Ver" lleva a los emails de ese dominio, de cualquier pestaña
    await fila.getByRole("link", { name: "Ver" }).click();
    await expect(page).toHaveURL(new RegExp(`dominio=${banco.replace(/\./g, "\\.")}`));
    await expect(page.getByRole("main").getByText(`E2E banco 1 ${tag}`)).toBeVisible();
    await expect(page.getByRole("main").getByText(`E2E banco 2 ${tag}`)).toBeVisible();

    await page.goto("/inbox");
    const mensajes: string[] = [];
    page.once("dialog", (d) => {
      mensajes.push(d.message());
      void d.accept();
    });
    await dominio(page, banco).getByRole("button", { name: "Eliminar todos" }).click();
    await expect(dominio(page, banco)).toHaveCount(0);
    expect(mensajes[0]).toMatch(
      new RegExp(`¿Eliminar 2 emails de ${banco.replace(/\./g, "\\.")}\\?`),
    );
    expect((await inboundState(a.id, a.rawRef)).row).toBeNull();
    expect((await inboundState(b.id, b.rawRef)).row).toBeNull();
  });

  test("«Es fuente de empleo» y «No es de empleo» lo sacan del aviso sin borrar nada", async ({
    page,
  }) => {
    const c = await createInboundEmail({
      subject: `E2E cursos ${tag}`,
      from: `Cursos <hola@${cursos}>`,
    });
    await createInboundEmail({ subject: `E2E streaming ${tag}`, from: `S <info@${streaming}>` });
    await login(page);
    await page.goto("/inbox");

    // Sin categoría conocida dice "dominio nuevo"; el de streaming lleva su etiqueta
    await expect(dominio(page, cursos).getByText("dominio nuevo", { exact: true })).toBeVisible();
    await expect(dominio(page, streaming).getByText("streaming", { exact: true })).toBeVisible();

    await dominio(page, cursos).getByRole("button", { name: "Es fuente de empleo" }).click();
    await expect(dominio(page, cursos)).toHaveCount(0);
    expect(await senderVerdict(cursos)).toBe("empleo");
    expect((await inboundState(c.id, c.rawRef)).row).not.toBeNull();

    await dominio(page, streaming).getByRole("button", { name: "No es de empleo" }).click();
    await expect(dominio(page, streaming)).toHaveCount(0);
    expect(await senderVerdict(streaming)).toBe("no_empleo");

    await page.reload();
    await expect(dominio(page, cursos)).toHaveCount(0);
    await expect(dominio(page, streaming)).toHaveCount(0);
  });

  test("no avisa por fuentes de empleo esperadas ni por dominios vistos antes de las 48 h", async ({
    page,
  }) => {
    await createInboundEmail({
      subject: `E2E alerta ${tag}`,
      from: "LinkedIn <jobalerts-noreply@linkedin.com>",
      parser: "linkedin",
      error: null,
    });
    await createInboundEmail({
      subject: `E2E viejo antes ${tag}`,
      from: `V <a@${viejo}>`,
      receivedAt: new Date(Date.now() - 4 * 24 * 3_600_000),
    });
    await createInboundEmail({ subject: `E2E viejo hoy ${tag}`, from: `V <a@${viejo}>` });
    await login(page);
    await page.goto("/inbox");
    await expect(page.getByText(/en 24 h/)).toBeVisible();
    await expect(aviso(page).getByRole("listitem").filter({ hasText: "linkedin.com" })).toHaveCount(
      0,
    );
    await expect(aviso(page).getByRole("listitem").filter({ hasText: viejo })).toHaveCount(0);
  });
});
