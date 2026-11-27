import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, ownerDb } from "./helpers";

/**
 * Flujo 430 (R33-05, C-26 a C-35): «Esto es lo que entendí». Persona B (tester) con el modelo simulado: se
 * responden los temas hasta la revisión y ahí se prueba: ejemplos en gris con «Sin completar», «Quitar este
 * trabajo» aparte con confirmación y «Deshacer», «Agregar otro trabajo», skills como chips, idiomas con el
 * nivel explicado, links con https y el cierre «Guardar y ver mi CV». Nada se guarda hasta ese botón.
 * Datos inventados; se borran el historial y las llamadas del chat al terminar.
 */
const EMPRESA = `Empresa Ficticia Revision ${Date.now()}`;

test.use({ viewport: { width: 360, height: 800 } });
test.describe.configure({ mode: "serial" });

async function clean() {
  const { db, close } = ownerDb();
  try {
    // R33-02: el borrador automático del chat también se borra
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

// La persona B no existe hasta que un spec la crea: sin esto el login vuelve a /login?error=1
test.beforeAll(async () => {
  await ensureSecondUser();
  await clean();
});
test.afterAll(clean);

/** Respuesta guionada de cada tema; lo que no se conoce se saltea (el flujo de preguntas lo define `asistente`). */
function answerFor(question: string): string | null {
  const q = question.toLowerCase();
  if (q.includes("desde cuándo")) return "03/2021 - actual";
  if (q.includes("qué cargo")) return "Analista Junior";
  if (q.includes("qué hacías"))
    return "Armé reportes semanales; automaticé la revisión de reportes";
  if (q.includes("logro")) return "Bajé el tiempo de revisión de 5 a 3 días";
  if (q.includes("otro trabajo")) return "no";
  if (q.includes("qué estudios"))
    return "Universidad Ficticia, Licenciatura en Estadística, 2013 - 2018";
  if (q.includes("certificaciones")) return "no";
  if (q.includes("herramientas")) return "SQL, Excel";
  if (q.includes("idiomas")) return "Inglés B2, Portugués";
  if (q.includes("links")) return "no";
  if (q.includes("qué puesto") || q.includes("a qué puesto")) return "Analista de datos";
  if (q.includes("empresa")) return EMPRESA;
  return null;
}

async function reachReview(page: Page): Promise<void> {
  await page.goto("/cv/armar");
  await page.getByRole("button", { name: "Empezar" }).click();
  const answer: Locator = page.getByLabel("Tu respuesta");
  const review = page.getByRole("heading", { name: "Esto es lo que entendí", level: 2 });
  const send = page.getByRole("button", { name: /^(Responder y seguir|Enviar)$/ });
  for (let i = 0; i < 30 && !(await review.isVisible()); i++) {
    const log = page.getByTestId("cv-messages").locator("p");
    const question = (await log.last().innerText()).trim();
    const reply = answerFor(question);
    if (reply === null) {
      await page
        .getByRole("button", { name: /Saltear/ })
        .or(page.getByRole("link", { name: /Saltear/ }))
        .first()
        .click();
    } else {
      await answer.fill(reply);
      await send.click();
    }
    await expect
      .poll(async () => (await review.isVisible()) || (await answer.isEnabled()))
      .toBe(true);
  }
  await expect(review).toBeVisible();
}

test.describe("Flujo 430: Esto es lo que entendí", () => {
  test("ejemplos en gris, «Sin completar», agregar y quitar con deshacer", async ({ page }) => {
    await loginAsSecondUser(page);
    await reachReview(page);
    const card = page.getByTestId("cv-card");

    // Lo cargado es lo cargado; el ejemplo es solo un placeholder
    await expect(card.getByLabel("Empresa 1")).toHaveValue(EMPRESA);
    await expect(card.getByLabel("Empresa 1")).toHaveAttribute("placeholder", /^Ejemplo: /);

    // Agregar otro trabajo: nace vacío y dice «Sin completar»
    await card.getByRole("button", { name: "Agregar otro trabajo" }).click();
    await expect(card.getByLabel("Empresa 2")).toHaveValue("");
    await expect(card.getByLabel("Empresa 2")).toHaveAccessibleDescription("Sin completar");

    // Quitar: aparte, con confirmación; Cancelar no quita
    await card.getByRole("button", { name: "Quitar este trabajo 1" }).click();
    await expect(card.getByText("¿Quitar este trabajo?")).toBeVisible();
    await card.getByRole("button", { name: "Cancelar" }).click();
    await expect(card.getByLabel("Empresa 1")).toHaveValue(EMPRESA);

    // Quitar de verdad y deshacer
    await card.getByRole("button", { name: "Quitar este trabajo 1" }).click();
    await card.getByRole("button", { name: "Quitar", exact: true }).click();
    await expect(page.getByTestId("cv-trabajo-quitado")).toContainText("Quitaste el trabajo");
    await expect(card.getByLabel("Empresa 1")).toHaveValue("");
    await page.getByRole("button", { name: "Deshacer" }).click();
    await expect(card.getByLabel("Empresa 1")).toHaveValue(EMPRESA);
  });

  test("skills con chips, idiomas con el nivel explicado y links con https", async ({ page }) => {
    await loginAsSecondUser(page);
    await reachReview(page);
    const card = page.getByTestId("cv-card");

    // Habilidades: agregar con Enter y quitar el chip
    await card.getByLabel("Habilidades", { exact: true }).fill("Power BI");
    await card.getByLabel("Habilidades", { exact: true }).press("Enter");
    const chips = card.getByTestId("cv-skill-chips");
    await expect(chips).toContainText("Power BI");
    await chips.getByRole("button", { name: "Quitar la habilidad Power BI" }).click();
    await expect(chips).not.toContainText("Power BI");

    // Idiomas: el nivel con su explicación y poder sumar otro idioma
    const idiomas = card.getByTestId("cv-idiomas");
    await expect(idiomas.getByLabel("Nivel 1")).toContainText("B2: intermedio alto");
    await idiomas.getByRole("button", { name: "Agregar otro idioma" }).click();
    await idiomas
      .getByLabel(/^Idioma \d+$/)
      .last()
      .fill("Italiano");
    await idiomas
      .getByLabel(/^Nivel \d+$/)
      .last()
      .selectOption("A2");
    await expect(idiomas.getByLabel(/^Nivel \d+$/).last()).toHaveValue("A2");

    // Links: solo https
    const linkedin = card.getByLabel("LinkedIn");
    await linkedin.fill("http://example.com/perfil");
    await expect(card.getByText("Tiene que empezar con https://")).toBeVisible();
    await linkedin.fill("https://www.example.com/perfil");
    await expect(card.getByText("Tiene que empezar con https://")).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id),
    ).toEqual([]);
    const { scrollWidth, ancho } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      ancho: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(ancho);
  });

  test("el cierre es «Guardar y ver mi CV» y hasta entonces no se guarda nada", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await reachReview(page);
    await page.getByRole("button", { name: "Armar mi CV" }).click();
    await expect(page.getByRole("heading", { name: "Así queda tu CV", level: 2 })).toBeVisible();
    const { db, close } = ownerDb();
    try {
      const antes = await db
        .select({ id: s.careerHistory.id })
        .from(s.careerHistory)
        .where(eq(s.careerHistory.userId, E2E_B_USER_ID));
      expect(antes).toHaveLength(0);
    } finally {
      await close();
    }
    await page.getByRole("button", { name: "Guardar y ver mi CV" }).click();
    await expect(page.getByTestId("cv-saved")).toContainText("Guardamos");
  });
});
