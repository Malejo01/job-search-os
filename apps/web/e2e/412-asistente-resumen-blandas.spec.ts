import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 412 (R33-04, C-15 a C-20): «Resumen profesional» y habilidades blandas por situaciones en el chat de
 * `/cv/armar`. Persona B, con el modelo simulado (USD 0: estos temas no llaman al modelo):
 * - tres preguntas después del puesto y un borrador de 2 o 3 frases, editable, en «Esto es lo que entendí»;
 * - nunca una cifra o un dato que la persona no dijo;
 * - habilidades blandas propuestas por situaciones, con de dónde salieron, «Usarla» / «No, gracias», hasta 4;
 * - lo que la persona edita o elige es lo que sale en el CV.
 * Datos inventados; se borran al final.
 */
const EMPRESA = `Empresa Ficticia Resumen ${Date.now()}`;

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function clean() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    // las charlas que abre cada caso cuentan en el tope de inicios del día (5): se borran como en el spec 86
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

test.beforeAll(async () => {
  await ensureSecondUser();
  await clean();
});
test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

const messages = (page: Page) => page.getByTestId("cv-messages").locator("p");
const lastMessage = async (page: Page): Promise<string> =>
  (await messages(page).last().innerText()).trim();

function reply(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("hace cuánto trabajás")) return "Tres años en administración y reportes";
  if (q.includes("próximo trabajo")) return "Quiero sumarme a un equipo de datos";
  if (q.includes("cosas hacés bien")) return "Ordeno información y detecto errores";
  if (q.includes("coordinaste personas")) return "Coordiné a cuatro personas del área";
  if (q.includes("problema resolviste")) return "no";
  if (q.includes("clientes u otras áreas")) return "Atendí reclamos de clientes";
  if (q.includes("organizado o mejorado")) return "no";
  // El modelo simulado repregunta cuando la respuesta es corta y vaga (R4-16); se contesta con un ejemplo concreto
  // que sirve para cualquiera de los tres temas (fechas, tareas o logro) y solo dice lo ya contado
  if (q.includes("ejemplo concreto")) {
    // sin coma: con una coma el modelo simulado la parte en dos tareas y el trabajo llega a 4, el tope, y no queda
    // lugar para la viñeta de «Usarla»
    return "Armé tableros semanales para el equipo de ventas desde 03/2021";
  }
  if (q.includes("qué puesto") || q.includes("a qué puesto")) return "Analista de datos";
  if (q.includes("desde cuándo")) return "03/2021 - actual";
  if (q.includes("qué cargo")) return "Analista Junior";
  if (q.includes("qué hacías")) return "Armé reportes semanales; automaticé la revisión";
  if (q.includes("logro")) return "no";
  if (q.includes("otro trabajo")) return "no";
  if (q.includes("qué estudios"))
    return "Universidad Ficticia, Licenciatura en Estadística, 2013 - 2018";
  if (q.includes("certificaciones")) return "no";
  if (q.includes("herramientas")) return "SQL, Excel";
  if (q.includes("idiomas")) return "Inglés B2";
  if (q.includes("links")) return "no";
  if (q.includes("empresa")) return EMPRESA;
  throw new Error(`pregunta sin respuesta guionada: ${question}`);
}

test.describe("Flujo 412: resumen profesional y habilidades blandas", () => {
  test("recorrido: resumen editable, blandas con «Usarla» y el CV con lo que eligió", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/cv/armar");
    await page.goto("/cv/armar");
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    const answer = page.getByLabel("Tu respuesta");
    await expect(answer).toBeFocused();

    const review = page.getByRole("heading", { level: 2, name: "Esto es lo que entendí" });
    const asked: string[] = [];
    let blandasVistas = false;
    for (let i = 0; i < 25 && !(await review.isVisible()); i++) {
      const question = await lastMessage(page);
      asked.push(question.toLowerCase());
      const before = await messages(page).count();
      await answer.fill(reply(question));
      await page.getByRole("button", { name: "Responder y seguir", exact: true }).click();
      await expect
        .poll(
          async () => (await review.isVisible()) || (await messages(page).count()) > before + 1,
          {
            timeout: 20_000,
          },
        )
        .toBe(true);
      // las habilidades blandas se proponen cuando contestó las cuatro situaciones
      if (!blandasVistas && (await page.getByTestId("cv-blandas").isVisible())) {
        blandasVistas = true;
        const items = page.getByTestId("cv-blanda");
        // de lo que contó: liderazgo y comunicación (coordinó personas) y atención al cliente y trabajo en equipo
        await expect(items).toHaveCount(4);
        await expect(items.nth(0)).toContainText("Liderazgo");
        await expect(items.nth(0)).toContainText(`La sugerimos por lo que contaste en ${EMPRESA}`);
        await expect(items.nth(0)).toContainText("Coordiné a cuatro personas del área");
        await expect(page.getByTestId("cv-blandas")).toContainText(
          "Como máximo 4 habilidades blandas",
        );
        // nunca se agregan solas
        await expect(page.getByTestId("cv-blandas-elegidas")).toHaveCount(0);
        await items
          .nth(0)
          .getByRole("button", { name: /Usarla/ })
          .click();
        await expect(page.getByTestId("cv-blandas-elegidas")).toContainText("Liderazgo");
        await page
          .getByTestId("cv-blanda")
          .filter({ hasText: "Comunicación" })
          .getByRole("button", { name: /No, gracias/ })
          .click();
        await expect(page.getByTestId("cv-blanda").filter({ hasText: "Comunicación" })).toHaveCount(
          0,
        );
      }
    }
    await expect(review).toBeVisible();
    expect(blandasVistas).toBe(true);
    // no hubo una pregunta directa por habilidades blandas
    expect(asked.some((q) => q.includes("habilidades blandas"))).toBe(false);
    // el orden: puesto, tres del resumen, y recién después la experiencia
    const resumenIdx = asked.findIndex((q) => q.includes("hace cuánto trabajás"));
    const empresaIdx = asked.findIndex((q) => q.includes("en qué empresa"));
    expect(resumenIdx).toBeGreaterThan(-1);
    expect(empresaIdx).toBeGreaterThan(resumenIdx + 2);

    // Resumen profesional: un solo bloque con las palabras de la persona, sin «Objetivo» aparte
    const resumen = page.getByTestId("cv-resumen");
    await expect(resumen).toContainText("Resumen profesional");
    const campo = resumen.getByLabel("Resumen");
    const borrador = await campo.inputValue();
    expect(borrador).toContain("Tres años en administración y reportes.");
    expect(borrador).toContain("Busco un puesto de Analista de datos.");
    expect(borrador).toContain("Quiero sumarme a un equipo de datos.");
    expect(borrador.toLowerCase()).not.toContain("objetivo");
    // ninguna cifra que no haya dicho: solo el «tres» en letras que escribió
    expect(borrador).not.toMatch(/\d/);
    await expect(page.getByText("Objetivo", { exact: true })).toHaveCount(0);
    // la blanda elegida sigue a la vista; la rechazada no
    await expect(page.getByTestId("cv-blandas-elegidas")).toContainText("Liderazgo");

    // la persona lo edita y eso es lo que sale
    await campo.fill(`${borrador} Disfruto enseñar lo que aprendo.`);
    await page.getByRole("button", { name: "Armar mi CV" }).click();
    await expect(page.getByRole("heading", { name: "Así queda tu CV", level: 2 })).toBeFocused();
    const preview = page.getByTestId("cv-preview");
    await expect(preview).toContainText("Disfruto enseñar lo que aprendo.");
    await expect(preview).toContainText("Tres años en administración y reportes.");
    await expect(preview).toContainText("Liderazgo");
    await expect(preview).not.toContainText("Comunicación");
    // la viñeta que acompañó a «Usarla» entró a la experiencia, con las palabras de la persona
    await expect(preview).toContainText("Coordiné a cuatro personas del área");
  });

  test("un resumen vaciado queda vacío", async ({ page }) => {
    await clean(); // el caso anterior dejó un borrador: «Empezar» ofrecería «Retomarlo»
    await loginAsSecondUser(page);
    await page.goto("/cv/armar");
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    const answer = page.getByLabel("Tu respuesta");
    const review = page.getByRole("heading", { level: 2, name: "Esto es lo que entendí" });
    for (let i = 0; i < 25 && !(await review.isVisible()); i++) {
      const question = await lastMessage(page);
      const before = await messages(page).count();
      await answer.fill(reply(question));
      await page.getByRole("button", { name: "Responder y seguir", exact: true }).click();
      await expect
        .poll(
          async () => (await review.isVisible()) || (await messages(page).count()) > before + 1,
          {
            timeout: 20_000,
          },
        )
        .toBe(true);
    }
    await expect(review).toBeVisible();
    await page.getByTestId("cv-resumen").getByLabel("Resumen").fill("");
    await page.getByRole("button", { name: "Armar mi CV" }).click();
    const preview = page.getByTestId("cv-preview");
    await expect(preview).toBeVisible();
    // sin resumen escrito por la persona no se inventa uno
    await expect(preview).not.toContainText("Busco un puesto de");
  });
});
