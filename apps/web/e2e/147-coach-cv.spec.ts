import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 147 (R12-10, ADR-038): el coach de CV con el modelo en demo (`LLM_DEMO=1`, sin red ni gasto).
 * El servidor de los e2e corre con `CV_COACH=testers` y el agente de perfil en `testers`; la persona B es
 * tester (`ASSISTANT_TESTER_EMAILS`). Una tercera persona, creada acá y que no es tester, ve 404.
 *
 * - sin sesión, las rutas no devuelven datos (401, o el middleware redirige a /login);
 * - con el flag apagado para la persona, 404 sin tocar el modelo;
 * - ticket inválido → 409;
 * - recorrido: lectura (para el ticket) → «Revisar mi CV» → lista de plantillas → «Ya está, armalo».
 *
 * Todo inventado («Empresa A», «Empresa B»); lo creado se borra al final.
 */
test.describe.configure({ mode: "serial" });

const OUTSIDER_ID = "c0000000-0000-4000-8000-0000000c0a47";
const OUTSIDER_EMAIL = "coach-no-tester-147@dos.test";
const OUTSIDER_PASSWORD = "clave-de-prueba-147";
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
    // R33-02: el borrador automático del coach (propuestas sin confirmar) también se borra
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    await db
      .delete(s.careerHistory)
      .where(
        and(
          eq(s.careerHistory.userId, E2E_B_USER_ID),
          like(s.careerHistory.organization, "Empresa % (147)"),
        ),
      );
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, OUTSIDER_ID));
    await db.delete(s.profiles).where(eq(s.profiles.userId, OUTSIDER_ID));
    await db.delete(s.users).where(eq(s.users.id, OUTSIDER_ID));
  } finally {
    await close();
  }
}

/** POST desde la página: el navegador manda el `Origin` del sitio, como la app. */
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

test.describe("Flujo 147: coach de CV", () => {
  test.beforeAll(async () => {
    await cleanup();
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      await db.insert(s.careerHistory).values([
        {
          userId: E2E_B_USER_ID,
          kind: "trabajo",
          organization: "Empresa A (147)",
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
          organization: "Empresa B (147)",
          title: "Asistente administrativa",
          startMonth: "2019-01",
          endMonth: "2021-02",
          bullets: ["Ordené la facturación"],
          source: "cv",
          sort: 1,
        },
      ]);
      await db
        .insert(s.users)
        .values({
          id: OUTSIDER_ID,
          email: OUTSIDER_EMAIL,
          name: "Persona Sin Coach",
          passwordHash: hashPassword(OUTSIDER_PASSWORD),
          termsVersion: TERMS_VERSION,
          termsAcceptedAt: new Date(),
        })
        .onConflictDoNothing();
      await db
        .insert(s.profiles)
        .values({
          userId: OUTSIDER_ID,
          displayName: "Persona Sin Coach",
          locationCountry: "AR",
          careerAskedAt: new Date(), // R32-01: sin puestos, ya «pedida»
          inboundAddress: "u_coach_147@ingest.test",
          profileSummary:
            "Perfil ficticio de una persona sin acceso al coach para el flujo 147. No corresponde a nadie real.",
        })
        .onConflictDoNothing();
      // Onboarding completo (perfil y criterios activos): si no, la app la manda a /onboarding
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: OUTSIDER_ID, version: 1, active: true, rules: {} as never });
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    await cleanup();
    await removeSecondUser();
  });

  test("sin sesión, las rutas del coach no devuelven datos", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    for (const path of ["/api/cv-coach/diagnostico"]) {
      const res = await ctx.post(path, { data: { ticket: "x" }, maxRedirects: 0 });
      // El middleware redirige a /login (307) y, si llegara a la ruta, daría 401; nunca 200 ni 404
      expect([307, 401], path).toContain(res.status());
    }
    await ctx.dispose();
  });

  test("quien no es tester: la pantalla y las rutas dan 404 sin tocar el modelo", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OUTSIDER_EMAIL);
    await page.getByLabel("Contraseña").fill(OUTSIDER_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL(/\/hoy/);
    const res = await page.goto("/cv/coach");
    expect(res?.status()).toBe(404);
    const api = await post(page, "/api/cv-coach/diagnostico", { ticket: "x" });
    expect(api.status).toBe(404);
    const { db, close } = ownerDb();
    try {
      const calls = await db.select().from(s.llmCalls).where(eq(s.llmCalls.userId, OUTSIDER_ID));
      expect(calls).toHaveLength(0);
    } finally {
      await close();
    }
  });

  test("ticket inválido → 409; recorrido con el modelo de demo hasta «Ya está, armalo»", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loginAsSecondUser(page);

    // Ticket inventado: 409 antes de leer nada o llamar al modelo
    const bad = await post(page, "/api/cv-coach/diagnostico", { ticket: "pa1.0123456789ab.1.x" });
    expect(bad.status).toBe(409);

    // Sin ticket en la pestaña, la pantalla manda a la lectura
    await page.goto("/cv/coach");
    await expect(page.getByTestId("coach-expired")).toBeVisible();

    // La lectura del agente de perfil da el ticket de la charla (modelo de demo)
    const read = await post(page, "/api/cv-perfil/leer", { text: CV_TEXT });
    expect(read.status).toBe(200);
    const ticket = String(read.json?.ticket ?? "");
    expect(ticket).toMatch(/^pa1\./);
    await page.evaluate((t) => window.sessionStorage.setItem("jso:pa:ticket", t), ticket);

    await page.goto("/cv/coach");
    await page.getByTestId("coach-review").click();
    await expect(page.getByTestId("coach-issues")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Lo que le falta a tu CV para/ })).toBeVisible();
    // El problema del modelo de demo apunta al primer trabajo, con la plantilla del código
    await expect(page.getByTestId("coach-issue").first()).toContainText("Empresa A (147)");
    const stored = await page.evaluate(() => ({
      issues: window.sessionStorage.getItem("jso:coach:issues"),
      before: window.sessionStorage.getItem("jso:coach:before"),
    }));
    expect(stored.issues).toContain('"mac"');
    expect(stored.before).toContain("Empresa B (147)");

    // Recargar no vuelve a pedir el diagnóstico (cuenta en el tope de dos por charla)
    let reviews = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/cv-coach/diagnostico")) reviews++;
    });
    await page.reload();
    await expect(page.getByTestId("coach-issues")).toBeVisible();
    expect(reviews).toBe(0);

    // La charla: primera pregunta de plantilla (sin modelo), dos turnos con el modelo de demo
    await page.getByTestId("coach-start-chat").click();
    await page.waitForURL(/\/cv\/coach\/charla/);
    await expect(page.getByTestId("coach-line-coach").first()).toBeVisible();
    const answers = [
      "Con esos tableros el equipo cerraba las ventas del mes dos días antes",
      "Armé los tableros junto con el equipo de ventas",
    ];
    for (const [n, text] of answers.entries()) {
      await page.getByTestId("coach-answer").fill(text);
      await page.getByTestId("coach-send").click();
      await expect(page.getByTestId("coach-line-me").last()).toHaveText(text);
      // El acuse lo arma el código (el turno de demo no extrae nada: «no llegué a entender»)
      await expect(page.getByTestId("coach-line-ack")).toHaveCount(n + 1);
    }
    // Dos respuestas ilegibles sobre el mismo problema: se saltea y la lista se agota
    await expect(page.getByTestId("coach-done")).toBeVisible();
    // Dos llamadas a `cv_coach_turn` con el `label` de la charla, ninguna para la primera pregunta
    {
      const { db, close } = ownerDb();
      try {
        const turns = await db
          .select()
          .from(s.llmCalls)
          .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), eq(s.llmCalls.task, "cv_coach_turn")));
        expect(turns).toHaveLength(2);
        expect(turns.every((t) => t.label?.startsWith("cv:"))).toBe(true);
      } finally {
        await close();
      }
    }

    await page.getByTestId("coach-chat-finish").click();
    await page.waitForURL(/\/cv\/coach\/listo/);
    // «Qué mejoró» (R12-11): el problema salteado en la charla, con la plantilla del código, y sin viñetas
    // cambiadas (no se confirmó ninguna tarjeta)
    await expect(page.getByTestId("coach-improved")).toBeVisible();
    await expect(page.getByTestId("coach-improved-skipped")).toContainText("Empresa A (147)");
    await expect(page.getByTestId("coach-improved-resolved")).toHaveCount(0);
    await expect(page.getByTestId("coach-improved-items")).toHaveCount(0);
    // El CV sale del cierre del agente de perfil (cv_write con el verificador)
    await expect(page.getByTestId("pa-close-write")).toBeVisible();
  });
});
