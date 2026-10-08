import { expect, test, type Page } from "@playwright/test";
import {
  E2E_B_USER_ID,
  E2E_USER_ID,
  applicationOutcomeById,
  clearSenderVerdicts,
  createApplicationForSeedUser,
  createEvaluation,
  createInboundEmail,
  createJob,
  deleteInboundEmails,
  deleteJob,
  inboundState,
  jobStatus,
  login,
  loginAsSecondUser,
  removeSecondUser,
  seedSecondUserData,
  senderVerdictOf,
  type SecondUserData,
} from "./helpers";

/**
 * Flujo 20 (JS-098): IDOR entre dos usuarios. Logueado como A (el usuario de siempre), con un id
 * de B nunca se ve ni se cambia nada de B: ni por URL, ni disparando las server actions de A con
 * ids de B (el formulario se adultera en el navegador, como lo haría quien arma el POST a mano).
 * La verificación del lado de B se hace con la conexión del dueño. Datos inventados.
 */
test.describe("Flujo 20: dos usuarios, sin lectura ni escritura cruzada", () => {
  const tag = Date.now();
  let b: SecondUserData;
  let jobA: string;

  test.beforeAll(async () => {
    b = await seedSecondUserData(tag);
    jobA = await createJob({
      title: `Oferta Ficticia A ${tag}`,
      status: "evaluada",
      jdText: "JD ficticia de A para el flujo de dos usuarios.",
    });
    await createEvaluation(jobA);
    await createApplicationForSeedUser(jobA);
  });

  test.afterAll(async () => {
    await removeSecondUser();
    await deleteJob(jobA);
    await deleteInboundEmails(String(tag));
    await clearSenderVerdicts(String(tag));
  });

  /** Nada de B en el HTML de la página (ni en el payload de Next). */
  async function expectNoDataOfB(page: Page): Promise<void> {
    const html = await page.content();
    for (const secret of [b.title, b.company, b.jdToken, b.subject, b.domain]) {
      expect(html, `aparece "${secret}" de B`).not.toContain(secret);
    }
  }

  /** Abrir un recurso de B como A: 404, redirección o pantalla de no encontrado; nunca el dato. */
  async function expectBlocked(page: Page, path: string): Promise<void> {
    const response = await page.goto(path);
    await expectNoDataOfB(page);
    const text = await page.locator("body").innerText();
    const redirected = new URL(page.url()).pathname !== path;
    const notFound =
      response?.status() === 404 || /404|no se encontr|could not be found/i.test(text);
    expect(
      redirected || notFound,
      `${path} respondió ${response?.status()} y quedó en ${page.url()}`,
    ).toBe(true);
  }

  /** Cambia el valor de un campo hidden del formulario, como si se armara el POST a mano. */
  async function tamper(page: Page, scope: string, field: string, value: string): Promise<void> {
    const inputs = page.locator(`${scope} input[name="${field}"]`);
    expect(await inputs.count(), `no hay ${field} en ${scope}`).toBeGreaterThan(0);
    await inputs.evaluateAll(
      (els, v) => els.forEach((el) => ((el as HTMLInputElement).value = v)),
      value,
    );
  }

  test("por URL: la oferta, el email y la postulación de B no se abren", async ({ page }) => {
    await login(page);
    await expectBlocked(page, `/jobs/${b.jobId}`);
    await expectBlocked(page, `/inbox/${b.emailId}`);
    // Abrir el email ajeno no lo marca visto ni lo toca
    const state = await inboundState(b.emailId, b.rawRef);
    expect(state.row?.seenAt).toBeNull();
    expect(state.row?.dismissedAt).toBeNull();
    expect(state.blob).toBe(true);
    // Postulación de B: no hay página propia; la lista de A tampoco la trae
    await page.goto("/applications");
    await expectNoDataOfB(page);
    expect(await page.content()).not.toContain(b.applicationId);
  });

  test("las listas de A no traen nada de B", async ({ page }) => {
    await login(page);
    for (const path of [
      "/jobs",
      "/jobs/pending-jd",
      "/inbox",
      "/applications",
      "/market",
      "/plan",
    ]) {
      await page.goto(path);
      await expectNoDataOfB(page);
    }
  });

  test("cambiar el estado de la oferta de B desde el formulario de A no cambia nada de B", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${jobA}`);
    const estado = 'section[aria-label="Estado"] form:has(input[value="discard"])';
    await expect(page.locator(estado)).toHaveCount(1);
    await tamper(page, estado, "jobId", b.jobId);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.locator(estado).getByRole("button", { name: "Descartar" }).click(),
    ]);
    expect(await jobStatus(b.jobId)).toBe("evaluada");
    expect(await jobStatus(jobA)).toBe("evaluada");
  });

  test("cambiar el resultado de la postulación de B desde la lista de A no cambia nada de B", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/applications");
    const card = page.locator("li", { hasText: `Oferta Ficticia A ${tag}` });
    await expect(card).toBeVisible();
    await card.locator('input[name="applicationId"]').evaluate((el, v) => {
      (el as HTMLInputElement).value = v;
    }, b.applicationId);
    await card.getByLabel("Resultado").selectOption("rechazo_humano");
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      card.getByRole("button", { name: "Guardar resultado" }).click(),
    ]);
    expect(await applicationOutcomeById(b.applicationId)).toBe("sin_respuesta");
  });

  test("«No me sirve», «Eliminar» y «marcar dominio» con ids de B no tocan el email ni el dominio de B", async ({
    page,
  }) => {
    const dominioA = `dominio-a-${tag}.example`;
    const emailA = await createInboundEmail({
      subject: `Email ficticio de A ${tag}`,
      from: `Remitente A <aviso@mail.${dominioA}>`,
      redacted: true,
      error:
        "remitente no esperado: por privacidad se guardó solo remitente, asunto y fecha, sin el cuerpo",
    });
    await login(page);
    const acciones = 'div[role="group"][aria-label="Acciones del email"]';
    const post = () => page.waitForResponse((r) => r.request().method() === "POST");

    // No me sirve
    await page.goto(`/inbox/${emailA.id}`);
    await tamper(
      page,
      `${acciones} form:has(button[title="Esta fuente no me sirve"])`,
      "id",
      b.emailId,
    );
    await Promise.all([
      post(),
      page.locator(acciones).getByRole("button", { name: "No me sirve" }).click(),
    ]);
    expect((await inboundState(b.emailId, b.rawRef)).row?.dismissedAt).toBeNull();

    // Marcar el dominio de B como fuente de empleo desde el email de A: la decisión de B no cambia
    await page.goto(`/inbox/${emailA.id}`);
    const marcar = 'section[aria-label="Cuerpo no guardado"] form';
    await tamper(page, marcar, "domain", b.domain);
    await Promise.all([post(), page.locator(marcar).getByRole("button").click()]);
    expect(await senderVerdictOf(E2E_B_USER_ID, b.domain)).toBe("no_empleo");
    expect(await senderVerdictOf(E2E_USER_ID, b.domain)).not.toBe("no_empleo");

    // Eliminar
    await page.goto(`/inbox/${emailA.id}`);
    await tamper(page, acciones, "id", b.emailId);
    page.once("dialog", (d) => void d.accept());
    await Promise.all([
      post(),
      page.locator(acciones).getByRole("button", { name: "Eliminar" }).click(),
    ]);
    const state = await inboundState(b.emailId, b.rawRef);
    expect(state.row).not.toBeNull();
    expect(state.blob).toBe(true);
  });

  test("control positivo: los mismos formularios sin adulterar, con ids propios, sí cambian el dato de A", async ({
    page,
  }) => {
    const propia = await createJob({
      title: `Oferta Ficticia A propia ${tag}`,
      status: "evaluada",
      jdText: "JD ficticia de A para el control positivo.",
    });
    await createEvaluation(propia);
    const aplicacion = await createApplicationForSeedUser(propia);
    try {
      await login(page);
      await page.goto("/applications");
      const card = page.locator("li", { hasText: `Oferta Ficticia A propia ${tag}` });
      await expect(card).toBeVisible();
      await card.getByLabel("Resultado").selectOption("rechazo_humano");
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST"),
        card.getByRole("button", { name: "Guardar resultado" }).click(),
      ]);
      await expect.poll(() => applicationOutcomeById(aplicacion)).toBe("rechazo_humano");

      await page.goto(`/jobs/${propia}`);
      await page
        .locator('section[aria-label="Estado"] form:has(input[value="discard"])')
        .getByRole("button", { name: "Descartar" })
        .click();
      await expect.poll(() => jobStatus(propia)).toBe("descartada");
    } finally {
      await deleteJob(propia);
    }
  });

  test("B, logueado, sí ve lo suyo y no ve lo de A (control: el spec mide algo)", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${b.jobId}`);
    await expect(page.getByRole("heading", { name: b.title })).toBeVisible();
    await page.goto(`/inbox/${b.emailId}`);
    await expect(page.getByRole("heading", { name: b.subject })).toBeVisible();
    // Y lo de A, para B, es un 404
    const response = await page.goto(`/jobs/${jobA}`);
    const text = await page.locator("body").innerText();
    expect(response?.status() === 404 || /404|no se encontr|could not be found/i.test(text)).toBe(
      true,
    );
    expect(await page.content()).not.toContain(`Oferta Ficticia A ${tag}`);
  });
});
