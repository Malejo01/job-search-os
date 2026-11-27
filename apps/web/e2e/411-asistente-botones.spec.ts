import AxeBuilder from "@axe-core/playwright";
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
 * Flujo 411 (R33-03, C-06 a C-14): botones y flujo del chat de «No tengo CV» (`/cv/armar`). Persona B, con el
 * modelo simulado:
 * - bienvenida: la honestidad corta y arriba, los 7 temas nombrados;
 * - un solo «Responder y seguir»; «Saltear esta pregunta» como enlace con «Podés volver a esto más tarde»;
 * - avance como lista de 7 temas, con el actual marcado;
 * - «Volver a la pregunta anterior» sin reiniciar;
 * - «Terminar y armar» solo con datos suficientes, aparte y con confirmación («Falta: …»);
 * - lo salteado se puede volver a abrir;
 * - sin experiencia: el camino de proyectos, voluntariado y cursos.
 * Datos inventados; se borran al final.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

async function clean() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    // las charlas que abre cada caso cuentan en el tope de inicios del día (5): se borran como en el spec 86
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
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

/** Responde y espera a que la charla avance (llega más de un mensaje nuevo o cambia el último). */
async function say(page: Page, text: string): Promise<string> {
  const before = await messages(page).count();
  const answer = page.getByLabel("Tu respuesta");
  await answer.fill(text);
  const respuesta = page.waitForResponse(
    (r) => r.url().includes("/api/cv-chat") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Responder y seguir", exact: true }).click();
  // si el turno falla, el motivo exacto sale en el mensaje del test (código y texto fijo del servidor)
  const body = (await (await respuesta).json()) as {
    ok: boolean;
    error?: string;
    message?: string;
  };
  expect(body.ok, `turno: ${body.error ?? ""} ${body.message ?? ""}`).toBe(true);
  await expect.poll(() => messages(page).count(), { timeout: 20_000 }).toBeGreaterThan(before + 1);
  await expect(answer).toBeEnabled({ timeout: 20_000 });
  return lastMessage(page);
}

/** Una respuesta guionada para cada pregunta fija. */
function reply(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("hace cuánto trabajás")) return "Tres años en administración y reportes";
  if (q.includes("próximo trabajo")) return "Quiero sumarme a un equipo de datos";
  if (q.includes("cosas hacés bien")) return "Ordeno información y detecto errores";
  if (q.includes("qué puesto") || q.includes("a qué puesto")) return "Analista de datos";
  if (q.includes("qué cargo")) return "Analista Junior";
  if (q.includes("empresa")) return "Empresa Ficticia Botones";
  return "no";
}

/** Contesta hasta que la última pregunta cumple `until`. */
async function advanceUntil(page: Page, until: RegExp): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const q = await lastMessage(page);
    if (until.test(q)) return;
    await say(page, reply(q));
  }
  throw new Error(`no se llegó a ${until}`);
}

async function start(page: Page) {
  // cada caso arranca de cero: el borrador del caso anterior ofrecería «Retomarlo» en vez de «Empezar»
  await clean();
  await loginAsSecondUser(page);
  await page.goto("/cv/armar");
  await page.getByRole("button", { name: "Empezar", exact: true }).click();
  await expect(page.getByLabel("Tu respuesta")).toBeFocused();
}

test.describe("Flujo 411: botones y flujo del asistente", () => {
  test("bienvenida: la honestidad corta y arriba, y los 7 temas", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/cv/armar");
    const honestidad = page.getByTestId("cv-honestidad");
    await expect(honestidad).toContainText("Vos revisás todo antes de usarlo.");
    await expect(honestidad).toContainText("La IA no agrega datos que no dijiste.");
    await expect(honestidad).toContainText("No te asegura pasar ningún filtro.");
    // arriba del texto que explica cómo funciona
    const [yHonestidad, yComo] = await Promise.all([
      honestidad.boundingBox(),
      page.getByText(/Son 7 temas/).boundingBox(),
    ]);
    expect(yHonestidad!.y).toBeLessThan(yComo!.y);
    await expect(page.getByText(/legible por ATS/)).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("una sola acción principal, «Saltear» como enlace y avance en 7 temas", async ({ page }) => {
    await start(page);
    // un solo botón lima por pregunta; «Enviar» y «Saltear» sueltos ya no están
    await expect(page.getByRole("button", { name: "Responder y seguir", exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByRole("button", { name: "Enviar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Saltear", exact: true })).toHaveCount(0);
    const saltear = page.getByTestId("cv-saltear");
    await expect(saltear).toHaveText("Saltear esta pregunta");
    await expect(page.getByText("Podés volver a esto más tarde", { exact: true })).toBeVisible();
    // «Terminar y armar» no aparece sin datos suficientes
    await expect(page.getByRole("button", { name: "Terminar y armar" })).toHaveCount(0);

    // la lista de temas: siempre 7, con el actual marcado
    const topics = page.getByTestId("cv-topics").getByRole("listitem");
    await expect(topics).toHaveCount(7);
    await expect(topics.nth(0)).toContainText("Puesto");
    await expect(topics.nth(1)).toContainText("Resumen profesional");
    await expect(topics.nth(6)).toContainText("Links");
    await expect(page.getByTestId("cv-topics").locator('[aria-current="step"]')).toHaveCount(1);
    await expect(page.getByTestId("cv-progress")).toContainText("de 7 temas");
    // C-12: el aviso de privacidad del dictado no está a la vista debajo del campo: va detrás del ⓘ
    await expect(
      page
        .getByTestId("voice-input")
        .locator("p:visible")
        .filter({ hasText: /Gemini|servidor|navegador|voz/i }),
    ).toHaveCount(0);
    const info = page.getByTestId("voice-privacidad-info");
    if ((await info.count()) > 0) {
      await expect(info).toHaveAttribute("aria-expanded", "false");
      await info.click();
      await expect(info).toHaveAttribute("aria-expanded", "true");
      await expect(
        page
          .getByTestId("voice-input")
          .locator("p:visible")
          .filter({ hasText: /voz|navegador/i }),
      ).not.toHaveCount(0);
    }
  });

  test("volver a la pregunta anterior sin reiniciar", async ({ page }) => {
    await start(page);
    await expect(page.getByTestId("cv-volver-pregunta")).toHaveCount(0);
    const primera = await lastMessage(page);
    await say(page, reply(primera));
    const segunda = await lastMessage(page);
    expect(segunda).not.toBe(primera);
    await page.getByTestId("cv-volver-pregunta").click();
    // vuelve la pregunta anterior, el campo está vacío y la charla sigue (no se reinició)
    await expect.poll(() => lastMessage(page)).toBe(primera);
    await expect(page.getByLabel("Tu respuesta")).toHaveValue("");
    await expect(page.getByTestId("cv-volver-pregunta")).toHaveCount(0);
    // se puede volver a contestar y la charla avanza
    await say(page, reply(primera));
    expect(await lastMessage(page)).toBe(segunda);
  });

  test("lo salteado se puede volver a abrir", async ({ page }) => {
    await start(page);
    await advanceUntil(page, /hace cuánto trabajás/i);
    await page.getByTestId("cv-saltear").click();
    await expect.poll(() => lastMessage(page)).toMatch(/próximo trabajo/i);
    await say(page, reply(await lastMessage(page)));
    await say(page, reply(await lastMessage(page)));
    // el resumen quedó con una pregunta salteada: se ve y se puede retomar
    const salteado = page.getByTestId("cv-topics").locator('[data-status="skipped"]');
    await expect(salteado).toHaveCount(1);
    await expect(salteado).toContainText("Resumen profesional");
    await salteado.getByRole("button", { name: /Volver a este tema/ }).click();
    await expect.poll(() => lastMessage(page)).toMatch(/hace cuánto trabajás/i);
  });

  test("«Terminar y armar» solo con datos suficientes, aparte y con confirmación", async ({
    page,
  }) => {
    await start(page);
    await advanceUntil(page, /qué cargo/i);
    await say(page, "Analista Junior"); // ya hay un trabajo con empresa y cargo
    const zona = page.getByTestId("cv-terminar-zona");
    const terminar = zona.getByTestId("cv-terminar");
    await expect(terminar).toHaveText("Terminar y armar");
    // nunca al mismo nivel que «Responder y seguir»: es un enlace, no el botón principal
    const claseTerminar = (await terminar.getAttribute("class")) ?? "";
    const claseResponder = (await page.getByTestId("cv-responder").getAttribute("class")) ?? "";
    expect(claseTerminar).not.toBe(claseResponder);
    await terminar.click();
    const confirmar = page.getByTestId("cv-terminar-confirmar");
    await expect(confirmar).toContainText("Vas a armar tu CV con lo que contaste hasta ahora.");
    await expect(confirmar).toContainText("Falta:");
    await expect(confirmar).toContainText("¿Armarlo igual?");
    // «Seguir respondiendo» vuelve a la pregunta
    await zona.getByRole("button", { name: "Seguir respondiendo" }).click();
    await expect(page.getByTestId("cv-terminar-confirmar")).toHaveCount(0);
    // «Armar ahora» pasa a revisar lo que entendió
    await page.getByTestId("cv-terminar").click();
    await page.getByTestId("cv-terminar-armar").click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Esto es lo que entendí" }),
    ).toBeVisible();
  });

  test("sin experiencia: el camino de proyectos, voluntariado, estudios y cursos", async ({
    page,
  }) => {
    await start(page);
    await advanceUntil(page, /en qué empresa/i);
    const siguiente = await say(page, "No tengo experiencia laboral");
    expect(siguiente.toLowerCase()).toContain("estudios");
    for (const palabra of ["proyectos", "voluntariado", "cursos"]) {
      expect(siguiente.toLowerCase()).toContain(palabra);
    }
    expect(siguiente.toLowerCase()).not.toContain("falló");
  });
});
