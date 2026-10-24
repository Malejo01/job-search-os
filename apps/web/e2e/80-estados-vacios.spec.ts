import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { TERMS_VERSION } from "../lib/terms";
import { ownerDb } from "./helpers";

/**
 * Flujo 80 (R2): los estados vacíos principales de una persona recién llegada, con el texto que
 * explica por qué está vacío y el link al próximo paso (con su `href`, y la página de destino existe).
 *
 * Una sola cuenta propia, sin ofertas, sin skills, sin plan y sin alertas; no se toca el usuario e2e
 * compartido. Se crea directo en la base (usuario, perfil completo y criterios): el registro y el
 * onboarding ya los recorre el spec 78, y pasar por el paso 1 dispararía el recálculo de mercado
 * (`after()`), que cambia el estado de /market y /plan mientras se prueban.
 *
 * Qué cubre, y qué ya cubrían otros specs:
 * - /jobs sin ofertas: 47 (textos y hrefs). Acá se suma que cada destino existe.
 * - /hoy sin ofertas ni carrera: 69. Acá se suman «con carrera, sin alertas» y los vacíos de alertas
 *   y mercado con su link.
 * - /market y /plan sin skills y sin ofertas, /encaje sin carrera, sin ofertas evaluadas y sin skills:
 *   ningún spec los afirmaba con su link.
 *
 * Caché: el mercado público de una carrera dura 30 minutos y es compartido, por eso no se afirma
 * ningún número ni «hay / no hay ofertas públicas». «Tu encaje» dura 15 minutos por persona y
 * carrera: la carrera vacía (A) y la que se llena con ofertas (B) son distintas, y A es la primera
 * (la que también lee «Hoy»). Las frases que cambia el #229 se aceptan en las dos versiones.
 * Todo inventado.
 */
test.describe.configure({ mode: "serial" });

const ROLE_A = "customer_success";
const ROLE_B = "marketing_digital";

/** Una de las dos frases de «Hoy» sin ofertas: la de origin/main y la del #229 (U4). */
const HOY_NO_OFFERS = /Todavía (estamos leyendo|no llegaron) ofertas para vos/;
const HOY_NO_ALERTS = /Todavía no (llega ningún aviso|recibimos ninguna alerta)/;

test.describe("Flujo 80: estados vacíos de una persona nueva", () => {
  const tag = Date.now();
  const userId = randomUUID();
  const email = `vacios-${tag}@example.com`;
  // Aleatoria en cada corrida: los escaneos de secretos del CI marcan cualquier literal
  const secret = randomBytes(18).toString("base64url");

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.insert(s.users).values({
        id: userId,
        email,
        name: "Persona de Vacíos",
        passwordHash: hashPassword(secret),
        // Con la versión vigente: si no, el gate de términos la frena en /terminos-actualizados
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      });
      await db.insert(s.profiles).values({
        userId,
        displayName: "Persona de Vacíos",
        locationCountry: "AR",
        inboundAddress: `u_vacios_${tag}@ingest.test`,
        profileSummary:
          "Perfil ficticio de la persona de la prueba de estados vacíos. No corresponde a nadie real y solo existe en la base local.",
        targetRoles: [],
        targetRole: null,
      });
      await db
        .insert(s.evaluationCriteria)
        .values({ userId, version: 1, active: true, rules: {} as never });
    } finally {
      await close();
    }
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
          await deleteUserData(tx as never, userId);
        })
        .catch(() => {});
      // Respaldo si la transacción falló: lo que se insertó en el beforeAll, del hijo al padre
      await db
        .delete(s.jobs)
        .where(eq(s.jobs.userId, userId))
        .catch(() => {});
      await db
        .delete(s.evaluationCriteria)
        .where(eq(s.evaluationCriteria.userId, userId))
        .catch(() => {});
      await db
        .delete(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .catch(() => {});
      await db
        .delete(s.users)
        .where(eq(s.users.id, userId))
        .catch(() => {});
    } finally {
      await close().catch(() => {});
    }
  });

  /** Inicia sesión como la persona nueva (la URL cambia: waitForURL sirve). */
  async function loginAsNew(page: Page): Promise<void> {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(secret);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL("**/hoy**");
  }

  /** El link con ese nombre tiene ese `href` y lleva a una página que existe, con la sesión puesta. */
  async function expectNextStep(
    page: Page,
    scope: Locator,
    name: string | RegExp,
    href: string,
  ): Promise<void> {
    // `first()`: «Hoy» lista un «Ver el mercado de…» por carrera; el primero es el de la carrera A
    await expect(scope.getByRole("link", { name }).first()).toHaveAttribute("href", href);
    const res = await page.request.get(href.split("#")[0]!);
    expect(res.status(), `el destino ${href} responde`).toBeLessThan(400);
    // Con la sesión caída o sin onboarding el destino respondería 200 desde otra pantalla
    expect(res.url(), `el destino ${href} no redirige al login ni al onboarding`).not.toMatch(
      /\/(login|onboarding)/,
    );
  }

  async function setRoles(roles: string[]): Promise<void> {
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ targetRoles: roles, targetRole: roles[0] ?? null })
        .where(eq(s.profiles.userId, userId));
    } finally {
      await close();
    }
  }

  test("/jobs sin ofertas: «Todavía no tenés ofertas» y los tres caminos existen", async ({
    page,
  }) => {
    await loginAsNew(page);
    await page.goto("/jobs");
    const empty = page.getByTestId("jobs-empty-none");
    await expect(empty).toContainText("Todavía no tenés ofertas");
    await expectNextStep(page, empty, /Cargar una oferta/, "/jobs/new");
    await expectNextStep(page, empty, /Reenviar tus alertas/, "/settings/asistente");
    await expectNextStep(page, empty, /Esperar las ofertas/, "/settings#puesto");
  });

  test("/hoy sin carrera ni ofertas: los vacíos de ofertas, alertas y mercado llevan a elegir carrera y a las alertas", async ({
    page,
  }) => {
    await loginAsNew(page);
    const news = page.getByTestId("hoy-vacio-sin-ofertas");
    await expect(news).toContainText(HOY_NO_OFFERS);
    await expectNextStep(page, news, "Elegí tu carrera", "/settings#puesto");

    const alerts = page.getByTestId("hoy-alertas");
    await expect(alerts.getByTestId("hoy-vacio-alertas")).toContainText(HOY_NO_ALERTS);
    await expectNextStep(page, alerts, "Configurar mis alertas", "/settings/asistente");

    const market = page.getByTestId("hoy-mercado");
    await expect(market.getByTestId("hoy-vacio-mercado")).toContainText(
      "Todavía no elegiste carrera",
    );
    await expectNextStep(page, market, "Elegí tu carrera", "/settings#puesto");
  });

  test("/market sin skills y sin ofertas: dice que faltan, y lleva a cargarlas y a conectar el asistente", async ({
    page,
  }) => {
    await loginAsNew(page);
    const res = await page.goto("/market");
    expect(res?.status()).toBeLessThan(400);
    const main = page.getByRole("main");
    await expect(main.getByText(/Elegí una carrera y (ves|mirá) qué piden/)).toBeVisible();
    await expect(main.getByText(/sin datos todavía/i).first()).toBeVisible();

    const noLevels = page.getByTestId("market-sin-niveles");
    await expect(noLevels).toContainText("Todavía no cargaste tus skills");
    await expectNextStep(page, noLevels, "Cargar mis skills", "/settings/skills");

    // Sin ofertas ni mercado armado (la cuenta no pasó por el paso 1: no corrió ningún recálculo)
    await expect(main.getByText("Todavía no llegaron ofertas")).toBeVisible();
    await expectNextStep(page, main, "Conectar el asistente de email", "/settings/asistente");
  });

  test("/plan sin plan: dice que no llegaron ofertas ni skills, y lleva a cargar skills y al asistente", async ({
    page,
  }) => {
    await loginAsNew(page);
    const res = await page.goto("/plan");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Plan de formación" })).toBeVisible();
    const main = page.getByRole("main");

    const noLevels = page.getByTestId("market-sin-niveles");
    await expect(noLevels).toContainText("Todavía no cargaste tus skills");
    await expectNextStep(page, noLevels, "Cargar mis skills", "/settings/skills");

    await expect(main.getByText("Todavía no llegaron ofertas")).toBeVisible();
    await expectNextStep(page, main, "Conectar el asistente de email", "/settings/asistente");
    // Sin plan no hay lista de skills ni simulador
    await expect(page.getByTestId("plan-sim")).toHaveCount(0);
    await expect(main).not.toContainText(/Application error|Internal Server Error|Algo salió mal/i);
  });

  test("/encaje sin carrera: dice que primero hace falta la carrera y lleva a elegirla", async ({
    page,
  }) => {
    await loginAsNew(page);
    const res = await page.goto("/encaje");
    expect(res?.status()).toBeLessThan(400);
    const empty = page.getByTestId("encaje-vacio-sin-carrera");
    await expect(empty).toContainText("primero necesitamos saber tu carrera");
    await expectNextStep(page, empty, "Elegí tu carrera", "/settings#puesto");
  });

  test("/hoy con carrera y sin alertas: el vacío de ofertas lleva a sumar las alertas", async ({
    page,
  }) => {
    await setRoles([ROLE_A, ROLE_B]);
    await loginAsNew(page);
    const news = page.getByTestId("hoy-vacio-sin-ofertas");
    await expect(news).toContainText(HOY_NO_OFFERS);
    await expectNextStep(page, news, "Sumá tus alertas de empleo por email", "/settings/asistente");
    // Con carrera, el mercado de Hoy deja de pedirla y lleva al mercado de cada una
    const market = page.getByTestId("hoy-mercado");
    await expect(market.getByTestId("hoy-vacio-mercado")).toHaveCount(0);
    await expectNextStep(page, market, /^Ver el mercado de /, `/market?carrera=${ROLE_A}`);
  });

  test("/encaje con carrera y sin ofertas evaluadas: dice desde cuándo mira y que no hay nada para comparar", async ({
    page,
  }) => {
    await loginAsNew(page);
    const res = await page.goto(`/encaje?rol=${ROLE_A}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByTestId("encaje-base")).toContainText(
      /Todavía no hay ofertas evaluadas en los últimos \d+ días/,
    );
    // Sin ofertas no hay listas ordenadas ni aviso de skills: solo el titular y el mercado
    await expect(page.getByTestId("encaje-frase")).toBeVisible();
    await expect(page.getByTestId("encaje-frenos")).toHaveCount(0);
    await expect(page.getByTestId("encaje-vacio-sin-niveles")).toHaveCount(0);
    await expect(page.getByTestId("encaje-mercado")).toBeVisible();
  });

  test("/encaje con ofertas pero sin skills: dice que no puede comparar y lleva a cargarlas", async ({
    page,
  }) => {
    // 6 ofertas evaluadas con su checklist (mínimo 5 para armar las listas), sin ninguna skill cargada
    const { db, close } = ownerDb();
    try {
      for (let i = 1; i <= 6; i++) {
        const title = `Oferta Ficticia Vacíos ${tag} ${i}`;
        const [job] = await db
          .insert(s.jobs)
          .values({
            userId,
            companyRaw: `Empresa de Prueba ${tag} ${i}`,
            title,
            titleNormalized: title.toLowerCase(),
            canonicalUrl: `https://example.com/e2e-vacios/${tag}/${i}`,
            locationRaw: "Remoto (Brasil)",
            modality: "remoto",
            status: "evaluada",
            jdText: `Descripción ficticia ${i} (${tag}).`,
            flags: [],
            firstSeenAt: new Date(),
          })
          .returning({ id: s.jobs.id });
        await db.insert(s.evaluations).values({
          jobId: job!.id,
          userId,
          criteriaVersion: 1,
          promptVersion: "evaluate_job@e2e",
          model: "fake",
          hadFullJd: true,
          score: 6,
          locationOk: "ok",
          modality: "remoto",
          discipline: "ai_engineer",
          matchFuerte: [],
          gaps: [],
          bloqueadoresDuros: [],
          senalesPositivas: [],
          veredicto: "Evaluación de prueba (e2e).",
          accion: "guardar",
          decision: {
            checklist: {
              items: [
                {
                  id: "ingles",
                  kind: "estructurado",
                  nivel: "must",
                  pide: "Inglés fluido",
                  evidencia: null,
                  tenes: null,
                  status: "no_cumple",
                  fuente: { pide: "fuente", tenes: "perfil" },
                  bloquea: false,
                },
              ],
              must: { cumple: 0, no_cumple: 1, no_se_sabe: 0 },
              deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
              parcial: false,
              descarte_rapido: null,
            },
          },
        });
      }
    } finally {
      await close();
    }

    await loginAsNew(page);
    // La carrera B nunca se visitó: su «Tu encaje» no está en el caché de 15 minutos
    const res = await page.goto(`/encaje?rol=${ROLE_B}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByTestId("encaje-base")).toContainText("6 ofertas evaluadas");
    const noLevels = page.getByTestId("encaje-vacio-sin-niveles");
    await expect(noLevels).toContainText("Todavía no cargaste tus skills");
    await expect(noLevels).toContainText("no podemos decir qué tenés y qué te falta");
    await expectNextStep(page, noLevels, "Cargá tus skills", "/settings/skills");
    // Sin niveles no se arma lo que ya tenés ni lo que te falta
    await expect(page.getByTestId("encaje-tenes")).toHaveCount(0);
    await expect(page.getByTestId("encaje-falta")).toHaveCount(0);
  });
});
