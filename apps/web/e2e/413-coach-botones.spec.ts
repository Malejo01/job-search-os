import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 413 (R33-03, C-06 a C-13): los mismos botones y el mismo flujo en el coach de «Tengo CV»
 * (`/cv/coach/charla`). Persona B (tester del coach), con el modelo simulado:
 * - la honestidad corta y arriba; el aviso del borrador;
 * - un solo «Responder y seguir»; «Saltear esta pregunta» como enlace con su apoyo;
 * - avance como lista de temas, con el actual marcado;
 * - «Volver a la pregunta anterior»;
 * - «Terminar y armar» aparte, con confirmación («Falta: …») antes de que termine la revisión.
 * Todo inventado; lo creado se borra al final.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const CV_TEXT = [
  "Persona Ficticia",
  "Analista de datos en Empresa A, desde marzo de 2021 hasta hoy.",
  "Armé tableros de ventas en Excel y SQL para el equipo comercial.",
  "Asistente administrativa en Empresa B, de 2019 a 2021.",
  "Ordené la facturación y el archivo de proveedores.",
  "Estudios: Tecnicatura en Administración, Instituto Ficticio, 2018.",
].join("\n");

async function cleanup(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.careerHistory)
      .where(
        and(
          eq(s.careerHistory.userId, E2E_B_USER_ID),
          like(s.careerHistory.organization, "Empresa % (413)"),
        ),
      );
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

async function post(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        json: (await res.json().catch(() => null)) as Record<string, unknown> | null,
      };
    },
    { path, body },
  );
}

test.beforeAll(async () => {
  await cleanup();
  await ensureSecondUser();
  const { db, close } = ownerDb();
  try {
    await db.insert(s.careerHistory).values([
      {
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa A (413)",
        title: "Analista de datos",
        startMonth: "2021-03",
        endMonth: null,
        bullets: ["Armé tableros de ventas en Excel", "Responsable de reportes"],
        source: "cv",
        sort: 0,
      },
      {
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa B (413)",
        title: "Asistente administrativa",
        startMonth: "2019-01",
        endMonth: "2021-02",
        bullets: ["Ordené la facturación"],
        source: "cv",
        sort: 1,
      },
    ]);
  } finally {
    await close();
  }
});
test.afterAll(async () => {
  await cleanup();
  await removeSecondUser();
});

/** Lectura (para el ticket) → diagnóstico → charla. */
async function toChat(page: Page) {
  await loginAsSecondUser(page);
  const read = await post(page, "/api/cv-perfil/leer", { text: CV_TEXT });
  expect(read.status).toBe(200);
  await page.evaluate(
    (t) => window.sessionStorage.setItem("jso:pa:ticket", t),
    String(read.json?.ticket ?? ""),
  );
  await page.goto("/cv/coach");
  await page.getByTestId("coach-review").click();
  // con next dev la primera compilación del diagnóstico puede pasar los 10 s por defecto
  await expect(page.getByTestId("coach-issues")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("coach-start-chat").click();
  await page.waitForURL(/\/cv\/coach\/charla/);
  await expect(page.getByTestId("coach-line-coach").first()).toBeVisible();
}

test.describe("Flujo 413: botones y flujo del coach", () => {
  test("honestidad arriba, una sola acción principal, enlace para saltear y lista de temas", async ({
    page,
  }) => {
    await toChat(page);
    const honestidad = page.getByTestId("coach-honestidad");
    await expect(honestidad).toContainText("Vos revisás todo antes de usarlo.");
    await expect(honestidad).toContainText("La IA no agrega datos que no dijiste.");
    await expect(page.getByTestId("coach-draft-note")).toContainText(
      "Guardamos un borrador para que no pierdas nada.",
    );
    // C-06 y C-07
    await expect(page.getByTestId("coach-send")).toHaveText("Responder y seguir");
    await expect(page.getByRole("button", { name: "Responder", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "No tengo", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("coach-none")).toHaveText("Saltear esta pregunta");
    await expect(page.getByText("Podés volver a esto más tarde", { exact: true })).toBeVisible();
    // C-10: el avance como lista, con el actual marcado
    const topics = page.getByTestId("coach-topics").getByRole("listitem");
    expect(await topics.count()).toBeGreaterThan(0);
    await expect(page.getByTestId("coach-topics").locator('[aria-current="step"]')).toHaveCount(1);
  });

  test("volver a la pregunta anterior", async ({ page }) => {
    await toChat(page);
    await expect(page.getByTestId("coach-volver-pregunta")).toHaveCount(0);
    const primera = (await page.getByTestId("coach-line-coach").last().innerText()).trim();
    await page.getByTestId("coach-answer").fill("Con esos tableros el equipo cerraba el mes antes");
    await page.getByTestId("coach-send").click();
    await expect(page.getByTestId("coach-line-me")).toHaveCount(1);
    await page.getByTestId("coach-volver-pregunta").click();
    await expect(page.getByTestId("coach-line-me")).toHaveCount(0);
    await expect(page.getByTestId("coach-line-coach").last()).toHaveText(primera);
    await expect(page.getByTestId("coach-volver-pregunta")).toHaveCount(0);
  });

  test("«Terminar y armar» pide confirmación antes de que termine la revisión", async ({
    page,
  }) => {
    await toChat(page);
    const terminar = page.getByTestId("coach-chat-finish");
    await expect(terminar).toHaveText("Terminar y armar");
    await terminar.click();
    const confirmar = page.getByTestId("coach-terminar-confirmar");
    await expect(confirmar).toContainText("Vas a armar tu CV con lo que contaste hasta ahora.");
    await expect(confirmar).toContainText("Falta:");
    await expect(confirmar).toContainText("¿Armarlo igual?");
    await page.getByRole("button", { name: "Seguir respondiendo" }).click();
    await expect(page.getByTestId("coach-terminar-confirmar")).toHaveCount(0);
    await page.getByTestId("coach-chat-finish").click();
    await page.getByTestId("coach-terminar-armar").click();
    await page.waitForURL(/\/cv\/coach\/listo/);
  });
});
