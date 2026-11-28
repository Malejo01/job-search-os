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
 * Flujo 410 (R33-02, C-03 y C-05): borrador automático del CV, en los dos asistentes. Persona B (tester).
 * Con LLM_DEMO (sin red ni gasto):
 * - chat de `/cv/armar`: lo que se responde queda como borrador (tabla `cv_drafts`), no en el CV; al volver
 *   aparece «Tenés un borrador sin confirmar» con «Retomarlo» y «Empezar de nuevo»; retomar sigue en la
 *   pregunta siguiente y «Empezar de nuevo» lo descarta;
 * - coach: las propuestas sin confirmar se guardan y se leen por `/api/cv-coach/borrador`, y nadie lee las de
 *   otra persona;
 * - texto fijo «Guardamos un borrador para que no pierdas nada…» y la aclaración de «Volver a Tu CV».
 * Datos inventados; se borran al final.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const AVISO =
  "Guardamos un borrador para que no pierdas nada. Nada entra a tu CV hasta que lo confirmes.";

test.describe.configure({ mode: "serial" });

async function clean() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    // las charlas que abre cada caso cuentan en el tope de inicios del día (5)
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

async function drafts(kind: "chat" | "coach") {
  const { db, close } = ownerDb();
  try {
    return (await db.select().from(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID))).filter(
      (d) => d.kind === kind,
    );
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

/** Una respuesta guionada para cualquiera de las dos primeras preguntas que haga el chat. */
function answerFor(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("qué puesto") || q.includes("a qué puesto")) return "Analista de datos";
  if (q.includes("empresa")) return "Empresa Ficticia Borrador";
  return "no";
}

async function answerOne(page: Page): Promise<string> {
  const messages = page.getByTestId("cv-messages").locator("p");
  const question = (await messages.last().innerText()).trim();
  const answer = page.getByLabel("Tu respuesta");
  await answer.fill(answerFor(question));
  const respuesta = page.waitForResponse(
    (r) => r.url().includes("/api/cv-chat") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^(Enviar|Responder y seguir)$/ }).click();
  // si el turno falla, el motivo exacto sale en el mensaje del test (código y texto fijo del servidor)
  const body = (await (await respuesta).json()) as {
    ok: boolean;
    error?: string;
    message?: string;
  };
  expect(body.ok, `turno: ${body.error ?? ""} ${body.message ?? ""}`).toBe(true);
  // el campo se vacía cuando el turno termina
  await expect.poll(async () => (await answer.inputValue()) === "").toBe(true);
  return question;
}

test.describe("Flujo 410: borrador automático del CV", () => {
  test("chat: lo respondido queda como borrador, no como CV, y se puede retomar", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/cv/armar");
    // sin borrador: «Empezar», el aviso fijo y la aclaración de «Volver a Tu CV»
    await expect(page.getByTestId("cv-draft-found")).toHaveCount(0);
    await expect(page.getByText(AVISO)).toBeVisible();
    await expect(page.getByTestId("cv-back-note")).toContainText(
      "Tu progreso queda guardado como borrador.",
    );
    await page.getByRole("button", { name: "Empezar", exact: true }).click();
    await expect(page.getByLabel("Tu respuesta")).toBeFocused();
    // todavía no se respondió nada: no hay borrador
    expect(await drafts("chat")).toHaveLength(0);

    await answerOne(page);
    await answerOne(page);

    // quedó un borrador del chat y nada en el historial (el CV)
    const rows = await drafts("chat");
    expect(rows).toHaveLength(1);
    const { db, close } = ownerDb();
    try {
      const cv = await db
        .select({ id: s.careerHistory.id })
        .from(s.careerHistory)
        .where(eq(s.careerHistory.userId, E2E_B_USER_ID));
      expect(cv).toHaveLength(0);
    } finally {
      await close();
    }

    // al volver: el borrador sin confirmar, con las dos salidas
    await page.goto("/cv/armar");
    const found = page.getByTestId("cv-draft-found");
    await expect(found).toContainText("Tenés un borrador sin confirmar.");
    await expect(found.getByRole("button", { name: "Retomarlo" })).toBeVisible();
    await expect(found.getByRole("button", { name: "Empezar de nuevo" })).toBeVisible();

    // retomar: sigue en la pregunta que venía, con lo ya dicho
    await found.getByRole("button", { name: "Retomarlo" }).click();
    await expect(page.getByLabel("Tu respuesta")).toBeFocused();
    const next = (await page.getByTestId("cv-messages").locator("p").last().innerText()).trim();
    expect(next.length).toBeGreaterThan(5);
    // y el borrador sigue guardado, ahora con un turno más cuando responde
    await answerOne(page);
    const after = await drafts("chat");
    expect(after).toHaveLength(1);
    expect(after[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.updatedAt.getTime());
  });

  test("chat: «Empezar de nuevo» descarta el borrador y retomar sin borrador da un mensaje fijo", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/cv/armar");
    const found = page.getByTestId("cv-draft-found");
    await expect(found).toBeVisible();
    await found.getByRole("button", { name: "Empezar de nuevo" }).click();
    // arranca limpio: la primera pregunta de la charla
    await expect(page.getByLabel("Tu respuesta")).toBeFocused();
    expect(await drafts("chat")).toHaveLength(0);

    const sinBorrador = await page.request.post("/api/cv-chat", {
      data: { action: "resume" },
      headers: { Origin: BASE_URL },
    });
    expect(sinBorrador.status()).toBe(404);
    expect(await sinBorrador.json()).toMatchObject({ ok: false, error: "no_draft" });
  });

  test("chat: sin Origin el pedido de retomar o descartar da 403", async ({ page }) => {
    await loginAsSecondUser(page);
    for (const action of ["resume", "discard"]) {
      const r = await page.request.post("/api/cv-chat", { data: { action } });
      expect(r.status()).toBe(403);
    }
  });

  test("coach: las propuestas sin confirmar se guardan, se leen y se borran", async ({ page }) => {
    await loginAsSecondUser(page);
    const post = (data: unknown) =>
      page.request.post("/api/cv-coach/borrador", { data, headers: { Origin: BASE_URL } });

    const sinOrigin = await page.request.post("/api/cv-coach/borrador", {
      data: { action: "load" },
    });
    expect(sinOrigin.status()).toBe(403);

    const vacio = await (await post({ action: "load" })).json();
    expect(vacio).toMatchObject({ ok: true, cards: [] });

    const card = {
      kind: "note",
      key: "cc:1",
      historyId: null,
      text: "Coordinaba un equipo de cuatro personas",
      about: "patch",
    };
    const saved = await post({ action: "save", cards: [card] });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({ ok: true, saved: 1 });
    expect(await drafts("coach")).toHaveLength(1);
    const leido = await (await post({ action: "load" })).json();
    expect(leido.cards).toEqual([card]);

    // una tarjeta fuera de esquema no entra al borrador
    const mala = await post({ action: "save", cards: [{ kind: "bullets" }] });
    expect(await mala.json()).toMatchObject({ ok: true, saved: 0 });
    expect(await drafts("coach")).toHaveLength(0);

    await post({ action: "save", cards: [card] });
    expect((await post({ action: "discard" })).status()).toBe(200);
    expect(await drafts("coach")).toHaveLength(0);
  });

  test("coach: sin sesión no hay acceso al borrador", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const anon = await context.request.post("/api/cv-coach/borrador", {
      data: { action: "load" },
      headers: { Origin: BASE_URL },
      maxRedirects: 0,
    });
    // El middleware redirige a /login (307) y, si llegara a la ruta, daría 401; nunca 200
    expect([307, 401]).toContain(anon.status());
    await context.close();
  });
});
