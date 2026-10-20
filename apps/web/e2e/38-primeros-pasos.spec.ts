import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { desc, eq } from "drizzle-orm";
import {
  E2E_EMAIL,
  FIRST_STEPS_COOKIE,
  closePrivacyDialog,
  ensureSecondUser,
  loginAsSecondUser,
  login,
  ownerDb,
  removeSecondUser,
} from "./helpers";
import {
  assignPool,
  cleanup,
  completeStep1,
  createInvitation,
  fillSkills,
  newRun,
  register,
  seedAndEvaluate,
  seedPool,
} from "./personas/flow";

/**
 * Flujo 38 (ronda 49): «Primeros pasos». La checklist de /jobs, el «Paso N de 3» del onboarding, la
 * ayuda de CEFR, el aviso de alertas arriba de «Tus primeras ofertas», el modal de privacidad del
 * asistente y la tarjeta «Invitar a alguien» de Ajustes. Con personas nuevas (`personas/flow.ts`),
 * no con el usuario e2e principal: `login()` le deja la cookie de «Ocultar» para que su checklist
 * no mueva los conteos de los demás specs. Sin LLM ni red; todo inventado.
 */
test.describe.configure({ mode: "serial" });

const PRIVACY_COOKIE = "jso_privacidad_ok";

const checklist = (page: Page) => page.getByTestId("first-steps");
const steps = (page: Page) => page.locator('[aria-current="step"]');

/** Alto del elemento en px (falla si no tiene caja). */
async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  expect(b, "el elemento tiene que estar renderizado").not.toBeNull();
  return b!;
}

/** Ids de las ofertas evaluadas de mayor score del usuario (puede haber empates en el demo). */
async function bestEvaluatedJobIds(userId: string): Promise<string[]> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({ jobId: s.evaluations.jobId, score: s.evaluations.score })
      .from(s.evaluations)
      .where(eq(s.evaluations.userId, userId))
      .orderBy(desc(s.evaluations.score));
    expect(rows.length, "el worker demo evaluó las ofertas").toBeGreaterThan(0);
    const top = String(rows[0]!.score);
    return rows.filter((r) => String(r.score) === top).map((r) => r.jobId);
  } finally {
    await close();
  }
}

test.describe("Flujo 38: primeros pasos, de la persona nueva a la checklist completa", () => {
  const run = newRun("lucia");
  let context: BrowserContext | undefined;
  let page: Page;
  let bestJobId = "";

  test.beforeAll(async ({ browser }) => {
    await createInvitation(run);
    await seedPool(run);
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
    await cleanup(run, context);
  });

  test("38f y 38g: paso 1 de 3, con la ayuda de CEFR", async () => {
    await register(page, run);

    await expect(page.getByText("Paso 1 de 3")).toBeVisible();
    await expect(steps(page)).toHaveCount(1);

    // La etiqueta no cambia: los specs de onboarding la buscan así
    const cefr = page.getByLabel(/Inglés \(nivel CEFR\)/);
    await expect(cefr).toBeVisible();
    await expect(cefr).toHaveAttribute("aria-describedby", "cefr-help");
    await expect(page.locator("#cefr-help")).toBeVisible();

    const help = page.locator("details").filter({ hasText: "¿Qué es CEFR?" });
    await expect(help).toHaveJSProperty("open", false);
    await help.getByText("¿Qué es CEFR?").click();
    await expect(help).toHaveJSProperty("open", true);
    for (const level of ["B1 · intermedio", "B2 · intermedio alto", "C1 · avanzado"]) {
      await expect(help.getByText(level)).toBeVisible();
    }
  });

  test("38f: paso 2 de 3 en skills y paso 3 de 3 en las primeras ofertas", async () => {
    await completeStep1(page, run);
    await expect(page.getByText("Paso 2 de 3")).toBeVisible();
    await expect(steps(page)).toHaveCount(1);

    await fillSkills(page, run);
    await expect(page.getByText("Paso 3 de 3")).toBeVisible();
    await expect(steps(page)).toHaveCount(1);
  });

  test("38i: el aviso de alertas está arriba de «Tus primeras ofertas», con «Ir a mis ofertas» arriba y al final", async () => {
    await page.goto("/onboarding/ofertas");
    const banner = page.getByTestId("email-nudge");
    await expect(banner).toContainText("LinkedIn, Get on Board e Indeed");
    await expect(banner.getByRole("link", { name: "Conectar mis alertas" })).toHaveAttribute(
      "href",
      "/onboarding/asistente",
    );
    await expect(banner.getByRole("button", { name: "No, gracias" })).toBeVisible();

    // Arriba de todo lo que muestra la página: «buscando…», el vacío o la lista
    const content = page
      .locator(
        '[data-testid="first-offer"], [data-testid="first-offers-searching"], [data-testid="first-offers-empty"]',
      )
      .first();
    await expect(content).toBeVisible();
    expect((await box(banner)).y).toBeLessThan((await box(content)).y);

    // «Ir a mis ofertas»: uno arriba del aviso y otro al final; «Conectar» ya no va abajo
    const goToJobs = page.getByRole("link", { name: "Ir a mis ofertas" });
    await expect(goToJobs).toHaveCount(2);
    expect((await box(goToJobs.first())).y).toBeLessThan((await box(banner)).y);
    expect((await box(goToJobs.last())).y).toBeGreaterThan((await box(content)).y);
    await expect(page.getByRole("link", { name: /Conectar mis alertas de email/ })).toHaveCount(0);
    // El recuadro de privacidad salió de esta página (es un modal del asistente)
    await expect(page.getByTestId("trust-box")).toHaveCount(0);
  });

  test("38a: con skills y ofertas sembradas, la checklist muestra «3 de 5»", async () => {
    await seedAndEvaluate(run);
    await page.goto("/jobs");

    await expect(checklist(page)).toBeVisible();
    await expect(page.getByTestId("first-steps-count")).toHaveText(/3 de 5/);
    const items = checklist(page).getByRole("listitem");
    await expect(items).toHaveCount(6);
    await expect(items.nth(0)).toContainText("Completaste tu perfil");
    await expect(items.nth(1)).toContainText("Cargaste tus skills");
    await expect(items.nth(2)).toContainText("Te llegaron tus primeras ofertas");
    for (const i of [0, 1, 2]) await expect(items.nth(i)).toContainText("(hecho)");
    for (const i of [3, 4, 5]) await expect(items.nth(i)).toContainText("(pendiente)");

    // D2: mientras la checklist está visible, el aviso de email no se repite arriba de la lista
    await expect(page.getByTestId("email-nudge")).toHaveCount(0);
    await expect(items.nth(5)).toContainText("Conectá tus alertas de email");
    await expect(items.nth(5).getByRole("link", { name: "Conectar (5 min)" })).toHaveAttribute(
      "href",
      "/settings/asistente",
    );
  });

  test("38j: el modal de privacidad aparece una vez; «Entiendo y continúo» lo cierra y el link lo reabre", async () => {
    await page.goto("/onboarding/ofertas");
    await page
      .getByTestId("email-nudge")
      .getByRole("link", { name: "Conectar mis alertas" })
      .click();
    await page.waitForURL("**/onboarding/asistente**");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const trust = dialog.getByTestId("trust-box");
    await expect(trust).toContainText("Qué leemos");
    await expect(trust).toContainText("No tenemos acceso a tu cuenta de Gmail");

    await closePrivacyDialog(page);
    // La cookie la fija la acción del servidor: se espera antes de recargar
    await expect
      .poll(async () => (await context!.cookies()).find((c) => c.name === PRIVACY_COOKIE)?.value)
      .toBe(run.userId);

    await page.reload();
    await expect(page.getByRole("heading", { name: /Conectá tus alertas de email/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(dialog).toBeHidden();

    // El link lo reabre (con reintento: el botón responde recién cuando la página se hidrató) y Esc lo cierra
    const reopen = page.getByRole("button", { name: "Qué leemos y qué no" });
    await expect(async () => {
      await reopen.click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(dialog.getByTestId("trust-box")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("38i: «No, gracias» en las primeras ofertas también apaga el aviso en /jobs", async () => {
    await page.goto("/onboarding/ofertas");
    await page.getByTestId("email-nudge").getByRole("button", { name: "No, gracias" }).click();
    await expect(page.getByTestId("email-nudge")).toHaveCount(0);

    await page.goto("/jobs");
    await expect(page.getByTestId("email-nudge")).toHaveCount(0);
    // La misma cookie hace que el ítem de la checklist diga que no, y no vuelva a ofrecerlo
    const emailItem = checklist(page).getByRole("listitem").nth(5);
    await expect(emailItem).toContainText("Alertas de email: no por ahora");
    await expect(emailItem.getByRole("link")).toHaveCount(0);
  });

  test("38h: a 360 px la checklist no genera scroll horizontal y sus links miden al menos 44 px", async () => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/jobs");
    await expect(checklist(page)).toBeVisible();

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    const links = checklist(page).getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    for (const target of [
      ...(await links.all()),
      checklist(page).getByRole("button", { name: "Ocultar" }),
    ]) {
      expect((await box(target)).height).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("38b: «Abrir la mejor evaluada» lleva a la de mayor score y el 👍 pasa a «4 de 5»", async () => {
    const best = await bestEvaluatedJobIds(run.userId!);
    await page.goto("/jobs");
    const link = checklist(page).getByRole("link", { name: "Abrir la mejor evaluada" });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    bestJobId = new URL(page.url()).pathname.split("/").pop()!;
    expect(best, "lleva a una de las de mayor score").toContain(bestJobId);

    const yes = page
      .getByRole("group", { name: "¿Te sirve esta evaluación?" })
      // "Sí" hoy; "Sí, me sirve" con el #93 (nombre accesible): vale con cualquier orden de merge
      .getByRole("button", { name: /^Sí(, me sirve)?$/ });
    await yes.click();
    await expect(yes).toHaveAttribute("aria-pressed", "true");

    await page.goto("/jobs");
    await expect(page.getByTestId("first-steps-count")).toHaveText(/4 de 5/);
    // Con un solo paso por hacer la lista va plegada (ronda 73): el summary dice cuál falta
    const pending = checklist(page).getByText(/Te falta un paso:/);
    await expect(pending).toContainText("Cuando te postules, marcala como Aplicada");
    await pending.click();
    const item = checklist(page).getByRole("listitem").nth(3);
    await expect(item).toContainText("Le diste tu opinión a una oferta");
    await expect(item).toContainText("(hecho)");
  });

  test("38c: marcar «Aplicada» tilda el ítem 5 y la checklist dice «¡Listo!»", async () => {
    await page.goto(`/jobs/${bestJobId}`);
    await page.getByRole("button", { name: "Marcar aplicada" }).click();
    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();

    await page.goto("/jobs");
    await expect(checklist(page)).toContainText("¡Listo!");
    await expect(checklist(page).getByRole("button", { name: "Ocultar" })).toBeVisible();
    // Completa: ya no muestra la lista ni el contador
    await expect(page.getByTestId("first-steps-count")).toHaveCount(0);
  });

  test("38k: una cuenta que no puede invitar no ve la tarjeta «Invitar a alguien»", async () => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Cuenta" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invitar a alguien" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Crear invitación" })).toHaveCount(0);
  });

  test("38d: «Ocultar» persiste al recargar y no vale para otra cuenta del mismo navegador", async () => {
    await page.goto("/jobs");
    await checklist(page).getByRole("button", { name: "Ocultar" }).click();
    await expect(checklist(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
    await expect(checklist(page)).toHaveCount(0);

    // Misma cookie en el navegador, otra cuenta: se sale de la sesión conservando solo esa cookie
    await ensureSecondUser();
    const hidden = (await context!.cookies()).filter((c) => c.name === FIRST_STEPS_COOKIE);
    expect(hidden, "la cookie de «Ocultar» quedó en el navegador").toHaveLength(1);
    await context!.clearCookies();
    await context!.addCookies(hidden);
    await loginAsSecondUser(page);
    await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
    await expect(checklist(page)).toBeVisible();
  });
});

test.describe("Flujo 38e: «Saltear por ahora» en skills deja el ítem 2 pendiente", () => {
  const run = newRun("valentina");
  let context: BrowserContext | undefined;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await createInvitation(run);
    await seedPool(run);
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await cleanup(run, context);
  });

  test("sin skills cargadas, el ítem 2 apunta a /settings/skills", async () => {
    await register(page, run);
    await completeStep1(page, run);
    await page.getByRole("button", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/ofertas**");
    await assignPool(run);

    await page.goto("/jobs");
    await expect(checklist(page)).toBeVisible();
    const item = checklist(page).getByRole("listitem").nth(1);
    await expect(item).toContainText("Cargá tus skills");
    await expect(item).toContainText("(pendiente)");
    await expect(item.getByRole("link", { name: "Cargar mis skills" })).toHaveAttribute(
      "href",
      "/settings/skills",
    );
    // Perfil y ofertas sí están hechos; las skills, no
    await expect(page.getByTestId("first-steps-count")).toHaveText(/2 de 5/);
  });
});

test.describe("Flujo 38k: tarjeta «Invitar a alguien» en Ajustes del usuario e2e", () => {
  // El server de e2e hereda ADMIN_EMAILS del proceso: sin él nadie puede invitar (invitations-core.ts)
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const canInvite = admins.includes(E2E_EMAIL.toLowerCase());

  test("sin ADMIN_EMAILS la tarjeta no está", async ({ page }) => {
    test.skip(canInvite, "el usuario e2e es admin en este entorno");
    await login(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Cuenta" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invitar a alguien" })).toHaveCount(0);
  });

  test("con el usuario e2e en ADMIN_EMAILS la tarjeta lleva a /settings/invitations", async ({
    page,
  }) => {
    test.skip(!canInvite, "falta ADMIN_EMAILS con el email e2e en el entorno del runner");
    await login(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Invitar a alguien" })).toBeVisible();
    await expect(page.getByText("Mandale un link a quien quieras sumar a la beta.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear invitación" })).toHaveAttribute(
      "href",
      "/settings/invitations",
    );
  });
});
