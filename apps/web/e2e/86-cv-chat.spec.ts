import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  E2E_EMAIL,
  E2E_USER_ID,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 86 (C-25, CVC-5): «Armá tu CV con IA». Con LLM_DEMO (fake guionado, sin red ni gasto): responder
 * los temas, corregir algo en «Esto es lo que entendí», armar, ver la vista previa, confirmar y comprobar
 * que `career_history` queda con lo confirmado (source = chat). Un CV pegado se deriva, sin Origin da
 * 403, y con `CV_CHAT_ENABLED=all` una persona que no es admin (persona B) también usa el chat, con los
 * topes de la beta por persona y por mes (3 CV, 40 turnos; C2-1). axe y 360 px. Datos inventados y
 * únicos por corrida; se borran al final.
 */
const EMPRESA = `Empresa Ficticia CV ${Date.now()}`;
const CARGO_CORREGIDO = "Analista Corregido";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const e2eIsAdmin = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .includes(E2E_EMAIL.toLowerCase());

/**
 * Los flujos de la persona A siguen exigiendo que esté en `ADMIN_EMAILS` (el gate `admin` es el de
 * producción hasta el cambio a `all`). En el CI, si no está, el flujo no se probaría y el verde engañaría,
 * así que falla. En local se saltea. La persona B no lo necesita: con `all` el chat es de cualquier sesión.
 */
function requireAdmin(): void {
  if (e2eIsAdmin) return;
  if (process.env.CI) {
    throw new Error(
      "CI: ADMIN_EMAILS tiene que incluir al usuario de e2e; sin eso no se prueba el chat de CV",
    );
  }
  test.skip(true, "ADMIN_EMAILS no incluye al usuario de e2e en este entorno");
}

test.use({ viewport: { width: 360, height: 800 } });
test.describe.configure({ mode: "serial" });

async function clean() {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

test.beforeAll(clean);
test.afterAll(async () => {
  await clean();
  await removeSecondUser();
});

async function expectNoOverflowNorAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  const { scrollWidth, ancho } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    ancho: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(ancho);
}

/** La respuesta guionada de cada tema, según la pregunta fija que muestra la página. */
function answerFor(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("desde cuándo")) return "03/2021 - actual";
  if (q.includes("qué cargo")) return "Analista Junior";
  if (q.includes("qué hacías")) {
    return "Armé reportes semanales; automaticé la revisión de reportes";
  }
  if (q.includes("logro")) return "Bajé el tiempo de revisión de 5 a 3 días";
  if (q.includes("otro trabajo")) return "no";
  if (q.includes("qué estudios")) {
    return "Universidad Ficticia, Licenciatura en Estadística, 2013 - 2018";
  }
  if (q.includes("certificaciones")) return "no";
  if (q.includes("herramientas")) return "SQL, Excel";
  if (q.includes("idiomas")) return "Inglés B2, Portugués";
  if (q.includes("links")) return "no";
  if (q.includes("qué puesto") || q.includes("a qué puesto")) return "Analista de datos";
  if (q.includes("empresa")) return EMPRESA;
  throw new Error(`pregunta sin respuesta guionada: ${question}`);
}

async function lastMessage(page: Page): Promise<string> {
  return (await page.getByTestId("cv-messages").locator("p").last().innerText()).trim();
}

/** Contesta los temas que pregunte la página hasta que aparezca «Esto es lo que entendí». */
async function answerAll(page: Page, answer: Locator) {
  const review = page.getByRole("heading", { name: "Esto es lo que entendí", level: 2 });
  for (let i = 0; i < 25 && !(await review.isVisible()); i++) {
    await answer.fill(answerFor(await lastMessage(page)));
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await review.isVisible()) ||
          ((await answer.isVisible()) &&
            (await answer.isEnabled()) &&
            (await answer.inputValue()) === ""),
      )
      .toBe(true);
  }
  await expect(review).toBeVisible();
}

test.describe("Flujo 86: Armá tu CV con IA", () => {
  test("sin Origin el pedido da 403 y una persona que no es admin usa el chat (gate all)", async ({
    page,
    browser,
  }) => {
    await login(page);
    const sinOrigin = await page.request.post("/api/cv-chat", { data: { action: "start" } });
    expect(sinOrigin.status()).toBe(403);
    expect((await sinOrigin.json()).error).toBe("bad_origin");

    // Persona B: no está en ADMIN_EMAILS; con `CV_CHAT_ENABLED=all` el chat existe para cualquier sesión
    await ensureSecondUser();
    const contextB = await browser.newContext({ baseURL: BASE_URL });
    const pageB = await contextB.newPage();
    await loginAsSecondUser(pageB);
    const respuesta = await pageB.goto("/cv/armar");
    expect(respuesta?.status()).toBe(200);
    await expect(pageB.getByRole("button", { name: "Empezar" })).toBeVisible();
    await expect(pageB.getByText(/legible por ATS/)).toBeVisible();
    await expect(pageB.locator("body")).not.toContainText(/pasa los filtros|pasar los filtros/i);
    await pageB.goto("/cv");
    await expect(pageB.getByRole("link", { name: "Armá tu CV con IA" })).toBeVisible();
    const api = await pageB.request.post("/api/cv-chat", {
      data: { action: "start" },
      headers: { Origin: BASE_URL },
    });
    expect(api.status()).toBe(200);
    expect((await api.json()).ok).toBe(true);
    await contextB.close();
  });

  test("persona B: al llegar al tope mensual el mensaje es claro (40 turnos, 3 CV)", async ({
    browser,
  }) => {
    await ensureSecondUser();
    const contextB = await browser.newContext({ baseURL: BASE_URL });
    const pageB = await contextB.newPage();
    await loginAsSecondUser(pageB);
    const start = () =>
      pageB.request.post("/api/cv-chat", {
        data: { action: "start" },
        headers: { Origin: BASE_URL },
      });
    const seed = async (rows: { task: string; label: string }[]) => {
      const { db, close } = ownerDb();
      try {
        await db.insert(s.llmCalls).values(
          rows.map((r) => ({
            userId: E2E_B_USER_ID,
            task: r.task,
            model: "fake",
            ok: true,
            costUsd: 0,
            label: r.label,
          })),
        );
      } finally {
        await close();
      }
    };

    // 40 turnos de entrevista en el mes: no se puede empezar otra charla
    await seed(
      Array.from({ length: 40 }, (_, i) => ({ task: "cv_interview", label: `cv:e2e-t${i}` })),
    );
    const turnos = await start();
    expect(turnos.status()).toBe(429);
    const t = await turnos.json();
    expect(t).toMatchObject({ ok: false, error: "capped", cap: "turnos_mes" });
    expect(t.message).toContain("este mes");
    expect(t.message).toContain("a mano");
    await clean();

    // 3 CV armados en el mes: el cuarto no
    await seed(["a", "b", "c"].map((x) => ({ task: "cv_write", label: `cv:e2e-w${x}` })));
    const cvs = await start();
    expect(cvs.status()).toBe(429);
    expect(await cvs.json()).toMatchObject({ ok: false, error: "capped", cap: "mes" });
    await clean();
    await contextB.close();
  });

  test("un CV pegado se deriva y no llega al modelo", async ({ page }) => {
    requireAdmin();
    await login(page);
    await page.goto("/cv");
    await page.getByRole("link", { name: "Armá tu CV con IA" }).click();
    await page.waitForURL("**/cv/armar");
    await expectNoOverflowNorAxe(page);
    await page.getByRole("button", { name: "Empezar" }).click();
    const answer = page.getByLabel("Tu respuesta");
    await expect(answer).toBeFocused();

    const cv = [
      "Perfil",
      "Experiencia laboral",
      "Educación",
      "Idiomas",
      "Skills",
      "Trabajé en reportes y tableros para equipos comerciales de varias sucursales. ".repeat(20),
    ].join("\n");
    await answer.fill(cv);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("pegaste un CV entero");
    // No contó como turno: la pregunta sigue siendo la misma
    await expect(page.getByTestId("cv-messages").locator("p")).toHaveCount(1);
    const { db, close } = ownerDb();
    try {
      const rows = await db
        .select({ task: s.llmCalls.task })
        .from(s.llmCalls)
        .where(and(eq(s.llmCalls.userId, E2E_USER_ID), like(s.llmCalls.label, "cv:%")));
      // Solo quedó el registro del inicio de la charla: ninguna llamada al modelo
      expect(rows.map((r) => r.task)).toEqual(["cv_start"]);
    } finally {
      await close();
    }
  });

  test("S-2: como máximo 5 charlas nuevas por día, con el mensaje fijo", async ({ page }) => {
    requireAdmin();
    await clean();
    await login(page);
    const resultados: { status: number; cap?: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await page.request.post("/api/cv-chat", {
        data: { action: "start" },
        headers: { Origin: BASE_URL },
      });
      const body = (await r.json()) as { cap?: string };
      resultados.push({ status: r.status(), cap: body.cap });
    }
    expect(resultados.filter((r) => r.status === 200)).toHaveLength(5);
    expect(resultados.slice(5)).toEqual([
      { status: 429, cap: "inicios" },
      { status: 429, cap: "inicios" },
    ]);
    await clean();
  });

  test("recorrido completo: temas, corregir en la tarjeta, armar, confirmar y ver el CV", async ({
    page,
  }) => {
    requireAdmin();
    await login(page);
    await page.goto("/cv/armar");
    await page.getByRole("button", { name: "Empezar" }).click();
    const answer = page.getByLabel("Tu respuesta");
    await expect(answer).toBeFocused();
    await expect(page.getByTestId("cv-messages")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByTestId("cv-progress")).toContainText("Avance:");
    await expectNoOverflowNorAxe(page);

    await answerAll(page, answer);
    const review = page.getByRole("heading", { name: "Esto es lo que entendí", level: 2 });
    await expect(review).toBeFocused();
    const card = page.getByTestId("cv-card");
    await expect(card.getByLabel("Empresa 1")).toHaveValue(EMPRESA);
    await expect(card.getByLabel("Cargo 1")).toHaveValue("Analista Junior");
    await expect(card.getByLabel("Puesto")).toHaveValue("Analista de datos");

    // Corregir algo antes de armar
    await card.getByLabel("Cargo 1").fill(CARGO_CORREGIDO);
    await expectNoOverflowNorAxe(page);

    await page.getByRole("button", { name: "Armar mi CV" }).click();
    await expect(page.getByRole("heading", { name: "Así queda tu CV", level: 2 })).toBeFocused();
    const preview = page.getByTestId("cv-preview");
    await expect(preview.getByRole("heading", { name: "Experiencia", level: 2 })).toBeVisible();
    await expect(preview.getByRole("heading", { name: CARGO_CORREGIDO, level: 3 })).toBeVisible();
    await expect(preview).toContainText(EMPRESA);
    await expect(preview).toContainText("03/2021 – Actual");
    await expect(
      preview.getByRole("listitem").filter({ hasText: "Armé reportes semanales" }),
    ).toBeVisible();
    await expect(page.getByTestId("cv-verify-note")).toContainText("Redactado por IA y verificado");
    await expectNoOverflowNorAxe(page);

    // Nada se guardó hasta ahora
    const antes = ownerDb();
    try {
      const filas = await antes.db
        .select({ id: s.careerHistory.id })
        .from(s.careerHistory)
        .where(eq(s.careerHistory.userId, E2E_USER_ID));
      expect(filas).toHaveLength(0);
    } finally {
      await antes.close();
    }

    await page.getByRole("button", { name: "Confirmar y guardar en mi historial" }).click();
    await expect(page.getByTestId("cv-saved")).toContainText("Guardamos");

    const { db, close } = ownerDb();
    try {
      const filas = await db
        .select()
        .from(s.careerHistory)
        .where(eq(s.careerHistory.userId, E2E_USER_ID));
      const trabajo = filas.find((f) => f.organization === EMPRESA);
      expect(trabajo).toMatchObject({
        kind: "trabajo",
        title: CARGO_CORREGIDO,
        startMonth: "2021-03",
        endMonth: null,
        source: "chat",
      });
      expect(trabajo?.bullets).toContain("Armé reportes semanales");
      // Una llamada por turno más una de redacción; todas con la etiqueta de la charla
      const llamadas = await db
        .select({ task: s.llmCalls.task, model: s.llmCalls.model })
        .from(s.llmCalls)
        .where(and(eq(s.llmCalls.userId, E2E_USER_ID), like(s.llmCalls.label, "cv:%")));
      expect(llamadas.filter((l) => l.task === "cv_write")).toHaveLength(1);
      expect(llamadas.filter((l) => l.task === "cv_interview").length).toBeGreaterThan(3);
      expect(llamadas.filter((l) => l.task === "cv_start")).toHaveLength(1);
      expect(new Set(llamadas.filter((l) => l.task !== "cv_start").map((l) => l.model))).toEqual(
        new Set(["fake"]),
      );
    } finally {
      await close();
    }

    await page.getByRole("link", { name: "Ver mi CV" }).click();
    await page.waitForURL("**/cv");
    const cv = page.getByTestId("cv-preview");
    await expect(cv.getByRole("heading", { name: CARGO_CORREGIDO, level: 3 })).toBeVisible();
    await expect(cv).toContainText(EMPRESA);
  });

  test("con el cupo mensual usado, empezar otra charla avisa con mensaje fijo", async ({
    page,
  }) => {
    requireAdmin();
    const { db, close } = ownerDb();
    let perfil: { plan: string } | undefined;
    try {
      [perfil] = await db
        .select({ plan: s.profiles.plan })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
    test.skip(
      perfil?.plan !== "gratis",
      "el cupo del plan pago es de 5: este caso es del gratis (piso de 3 en la beta)",
    );
    // El flujo anterior ya armó un CV: con otros dos queda el cupo de 3 de la beta usado
    const seed = ownerDb();
    try {
      await seed.db.insert(s.llmCalls).values(
        ["a", "b"].map((x) => ({
          userId: E2E_USER_ID,
          task: "cv_write",
          model: "fake",
          ok: true,
          costUsd: 0,
          label: `cv:e2e-cupo-${x}`,
        })),
      );
    } finally {
      await seed.close();
    }
    await login(page);
    await page.goto("/cv/armar");
    await page.getByRole("button", { name: "Empezar" }).click();
    const alerta = page.locator("main").getByRole("alert");
    await expect(alerta).toContainText("tope de CV armados con IA de este mes");
    await expect(alerta.getByRole("link", { name: "Historial" })).toBeVisible();
    await expectNoOverflowNorAxe(page);
  });
});
