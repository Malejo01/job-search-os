import { expect, test, type Page } from "@playwright/test";
import {
  activeSeedCriteria,
  applicationOutcomeAndNote,
  backupSeedCriteria,
  createApplicationForSeedUser,
  createEvaluation,
  createJob,
  deleteJob,
  login,
  restoreSeedCriteria,
  seedTargetRoles,
  setSeedTargetRoles,
  type CriteriaBackup,
} from "./helpers";

/**
 * Flujo 37 (ronda 30c): guardar dos veces seguidas el mismo formulario SIN recargar. Los tres
 * formularios son Server Component (o cliente con estado propio) que muestran lo guardado con
 * `defaultValue`/`useState`: si no se resincronizan tras el guardado, el segundo envío manda lo
 * viejo. Entre el primer y el segundo guardado no hay `goto` ni `reload`; solo se espera a que la
 * base tenga lo guardado. Datos inventados; criterios y puestos del usuario e2e se restauran.
 */
/** Toca el botón y espera la respuesta del servidor (la acción POSTea a la misma ruta). */
async function clickAndWaitAction(page: Page, click: () => Promise<void>): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), click()]);
}

test.describe("Flujo 37a: resultado de una postulación", () => {
  const tag = Date.now();
  const title = `E2E guardar2 resultado ${tag}`;
  let jobId: string;
  let applicationId: string;

  test.beforeAll(async () => {
    jobId = await createJob({ title, status: "aplicada", jdText: "JD de prueba." });
    await createEvaluation(jobId);
    applicationId = await createApplicationForSeedUser(jobId);
  });
  test.afterAll(async () => {
    await deleteJob(jobId);
  });

  test("guardar resultado y nota, y volver a guardar sin recargar, conserva ambos", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/applications");
    // La tarjeta con el formulario: la lista de "sorpresas" de arriba también nombra la oferta
    const card = page
      .locator("li", { hasText: title })
      .filter({ has: page.getByRole("button", { name: "Guardar resultado", exact: true }) });
    const save = card.getByRole("button", { name: "Guardar resultado", exact: true });
    await expect(card).toBeVisible();

    // 1) Primer guardado: resultado y nota
    await card.getByLabel("Resultado", { exact: true }).selectOption("rechazo_humano");
    await card.getByPlaceholder("Nota (opcional)").fill("nota uno");
    await clickAndWaitAction(page, () => save.click());
    await expect
      .poll(() => applicationOutcomeAndNote(applicationId))
      .toEqual({ outcome: "rechazo_humano", note: "nota uno" });
    // Señal server-rendered del dato nuevo (badge y <p> de la nota): recién ahí ya hubo render y reset
    await expect(card.locator("span", { hasText: "Rechazo humano" })).toBeVisible();
    await expect(card.getByText("nota uno", { exact: true })).toBeVisible();

    // Sin recargar: el select y el input muestran lo guardado
    await expect(card.getByLabel("Resultado", { exact: true })).toHaveValue("rechazo_humano");
    await expect(card.getByPlaceholder("Nota (opcional)")).toHaveValue("nota uno");

    // 2) Segundo guardado sin tocar nada: la base conserva resultado y nota
    await clickAndWaitAction(page, () => save.click());
    expect(await applicationOutcomeAndNote(applicationId)).toEqual({
      outcome: "rechazo_humano",
      note: "nota uno",
    });
    await expect(card.locator("span", { hasText: "Rechazo humano" })).toBeVisible();
    await expect(card.getByText("nota uno", { exact: true })).toBeVisible();
    await expect(card.getByPlaceholder("Nota (opcional)")).toHaveValue("nota uno");

    // 3) Cambiar solo el resultado: la nota sigue siendo "nota uno"
    await card.getByLabel("Resultado", { exact: true }).selectOption("entrevista");
    await clickAndWaitAction(page, () => save.click());
    await expect
      .poll(() => applicationOutcomeAndNote(applicationId))
      .toEqual({ outcome: "entrevista", note: "nota uno" });
    await expect(card.locator("span", { hasText: "Entrevista" })).toBeVisible();
    await expect(card.getByText("nota uno", { exact: true })).toBeVisible();
    await expect(card.getByLabel("Resultado", { exact: true })).toHaveValue("entrevista");
    await expect(card.getByPlaceholder("Nota (opcional)")).toHaveValue("nota uno");
  });
});

test.describe("Flujo 37b: criterios", () => {
  let backup: CriteriaBackup = [];
  let ready = false;

  test.beforeAll(async () => {
    backup = await backupSeedCriteria();
    ready = true;
  });
  // Son los criterios reales del usuario e2e: se borran las versiones nuevas y se reactiva la original
  test.afterAll(async () => {
    if (ready) await restoreSeedCriteria(backup);
  });

  test("guardar una versión nueva y volver a guardar sin recargar no revierte ni da conflicto", async ({
    page,
  }) => {
    const start = await activeSeedCriteria();
    expect(start, "el usuario e2e tiene criterios activos").not.toBeNull();
    const newYears = start!.maxYearsHard >= 40 ? start!.maxYearsHard - 1 : start!.maxYearsHard + 1;

    await login(page);
    await page.goto("/settings/criteria");
    const years = page.getByLabel(/Años máximos que tolerás/);
    const save = page.getByRole("button", { name: "Guardar como versión nueva", exact: true });
    await expect(years).toHaveValue(String(start!.maxYearsHard));

    // 1) Primer guardado
    await years.fill(String(newYears));
    await save.click();
    await page.waitForURL("**/settings/criteria?saved=1");
    await expect
      .poll(() => activeSeedCriteria())
      .toEqual({ version: start!.version + 1, maxYearsHard: newYears });

    // Sin recargar: el campo muestra el valor nuevo y la versión vigente es la nueva
    await expect(years).toHaveValue(String(newYears));
    await expect(page.getByText(`Versión vigente: ${start!.version + 1} `)).toBeVisible();

    // 2) Segundo guardado sin tocar nada: otra versión con el mismo valor, sin conflicto
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(() => activeSeedCriteria())
      .toEqual({ version: start!.version + 2, maxYearsHard: newYears });
    await expect(page.getByText(`Versión vigente: ${start!.version + 2} `)).toBeVisible();
    // El aviso de error de la página (no el anunciador de rutas de Next, que también es role=alert)
    await expect(page.locator("#criteria-error")).toHaveCount(0);
    expect(page.url()).not.toContain("error=");
    await expect(years).toHaveValue(String(newYears));
  });
});

test.describe("Flujo 37c: selector de puestos", () => {
  let original: { targetRoles: string[]; targetRole: string | null } | null = null;

  test.beforeAll(async () => {
    original = await seedTargetRoles();
    // Parte de un solo puesto, así sumar uno respeta el tope del plan gratis (2)
    await setSeedTargetRoles({ targetRoles: ["qa"], targetRole: "qa" });
  });
  test.afterAll(async () => {
    if (original) await setSeedTargetRoles(original);
  });

  async function savedRoles(): Promise<string[]> {
    return [...(await seedTargetRoles()).targetRoles].sort();
  }

  async function checkedRoles(page: Page): Promise<string[]> {
    const values = await page
      .locator('#puesto input[name="targetRoles"]')
      .evaluateAll((els) =>
        (els as HTMLInputElement[]).filter((e) => e.checked).map((e) => e.value),
      );
    return values.sort();
  }

  test("sumar un puesto y quitarlo sin recargar deja la base igual a lo que se ve", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings#puesto");
    const section = page.locator("#puesto");
    const count = section.getByTestId("role-picker-count");
    const saveRoles = section.getByRole("button", { name: "Guardar puestos", exact: true });
    // El test necesita tope 2 o más; con tope 1 falla acá con un mensaje claro
    await expect(count).toHaveText(/^1 de [2-9]/);
    const current = section.getByTestId("current-roles");
    const roleLabel = (key: string) =>
      section.locator(`label:has(input[name="targetRoles"][value="${key}"])`);

    // 1) Marcar un puesto más y guardar
    await section.locator('input[name="targetRoles"][value="ux_ui"]').check();
    await expect(count).toHaveText(/^2 de \d+/);
    await saveRoles.click();
    await page.waitForURL("**/settings?puesto=guardado**");
    await expect.poll(savedRoles).toEqual(["qa", "ux_ui"]);

    // Señal server-rendered: «Tus puestos actuales» muestra exactamente los de la base
    const qaLabel = ((await roleLabel("qa").textContent()) ?? "").trim();
    const uxLabel = ((await roleLabel("ux_ui").textContent()) ?? "").trim();
    await expect(current).toContainText(qaLabel);
    await expect(current).toContainText(uxLabel);
    // Sin recargar: casillas y contador coinciden con eso
    await expect.poll(() => checkedRoles(page)).toEqual(["qa", "ux_ui"]);
    await expect(count).toHaveText(/^2 de \d+/);

    // 2) Desmarcar uno y guardar de nuevo
    await section.locator('input[name="targetRoles"][value="ux_ui"]').uncheck();
    await expect(count).toHaveText(/^1 de \d+/);
    await clickAndWaitAction(page, () => saveRoles.click());
    await expect.poll(savedRoles).toEqual(["qa"]);
    await expect(current).toHaveText(`Tus puestos actuales: ${qaLabel}`);
    await expect.poll(() => checkedRoles(page)).toEqual(["qa"]);
    await expect(count).toHaveText(/^1 de \d+/);
  });
});
