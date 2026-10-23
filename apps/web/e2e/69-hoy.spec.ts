import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  E2E_USER_ID,
  createEvaluation,
  createJob,
  deleteJob,
  deleteSeededPublicJobs,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedPublicJobs,
  seedSecondUserData,
  seedTargetRoles,
  setSeedTargetRoles,
} from "./helpers";

/**
 * Flujo 69 (ronda 119): «Hoy», la pantalla de aterrizaje. Tres tarjetas por ahora: «Lo nuevo»,
 * «Tus alertas» y «Tu mercado esta semana» (la de seguimiento entra con el #155). Todo inventado.
 *
 * - A es el usuario seed; B es la persona nueva de los helpers (sin ofertas, mails ni carrera).
 * - La cookie `jso_ultima_visita` vale `${userId}.${anterior}.${actual}` (epoch en segundos). Para
 *   probar «desde la última visita» se pone una marca algo adelantada: así queda por delante de
 *   las evaluaciones recién creadas sin depender del reloj exacto.
 * - El mercado se cachea 30 minutos por carrera en el servidor: el caso 6 usa una carrera que
 *   ningún otro spec visita (customer_success) para que el pool sembrado acá sea el que se lee.
 */
test.describe.configure({ mode: "serial" });

const VISIT_COOKIE = "jso_ultima_visita";
const MARKET_CAREER = "customer_success";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Resumen de violaciones de axe: regla, impacto y selectores; nunca el HTML. */
async function axeSummary(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

test.describe("Flujo 69: Hoy", () => {
  const tag = Date.now();
  const titleHigh = `Oferta Ficticia Hoy Alta ${tag}`;
  const titleLow = `Oferta Ficticia Hoy Baja ${tag}`;
  const jobIds: string[] = [];

  test.beforeAll(async () => {
    const high = await createJob({
      title: titleHigh,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo Hoy.",
    });
    // 10 y 9: por encima de lo que dejan sembrado otros specs, así entran en el top 5 de la tarjeta
    await createEvaluation(high, { score: 10, accion: "aplicar" });
    const low = await createJob({
      title: titleLow,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo Hoy.",
    });
    await createEvaluation(low, { score: 9, accion: "aplicar" });
    jobIds.push(high, low);
  });

  test.afterAll(async () => {
    for (const id of jobIds) await deleteJob(id).catch(() => {});
    await removeSecondUser().catch(() => {});
  });

  test("el login aterriza en /hoy con el título, las tres tarjetas y «Hoy» marcado en el menú", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await expect(page).toHaveURL(/\/hoy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Hoy", exact: true })).toBeVisible();
    await expect(page.getByTestId("hoy-visita")).toHaveText("Primera vez por acá");
    for (const id of ["hoy-nuevo", "hoy-alertas", "hoy-mercado"]) {
      const section = page.getByTestId(id);
      await expect(section).toBeVisible();
      // Cada tarjeta es una región con nombre (section + aria-labelledby apuntando a su h2)
      await expect(section.getByRole("heading", { level: 2 })).toHaveCount(1);
    }

    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav.getByRole("link", { name: "Hoy", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    // «Hoy» es la primera sección del menú
    await expect(nav.getByRole("link").first()).toHaveText("Hoy");

    // La marca de visita la escribe el cliente al montar: httpOnly y con el id de la persona
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === VISIT_COOKIE)?.httpOnly)
      .toBe(true);
    const cookie = (await context.cookies()).find((c) => c.name === VISIT_COOKIE);
    expect(cookie?.value.startsWith(`${E2E_USER_ID}.`)).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  });

  test("sin cookie: «mejores de la semana», la de 10 primero y con su acción; con cookie posterior: «Nada nuevo»", async ({
    page,
    context,
    baseURL,
  }) => {
    await login(page);
    const card = page.getByTestId("hoy-nuevo");
    await expect(
      card.getByRole("heading", { name: "Tus mejores ofertas de la semana" }),
    ).toBeVisible();

    const high = card.getByTestId("hoy-nuevo-fila").filter({ hasText: titleHigh });
    const low = card.getByTestId("hoy-nuevo-fila").filter({ hasText: titleLow });
    await expect(high).toBeVisible();
    await expect(high).toContainText("Puntaje 10");
    await expect(high).toContainText("Aplicar");
    await expect(low).toBeVisible();
    await expect(low).toContainText("Puntaje 9");
    await expect(low).toContainText("Aplicar");
    // Por score descendente: entre las filas que haya, la de 10 aparece antes que la de 9
    const rows = await card.getByTestId("hoy-nuevo-fila").allTextContents();
    const iHigh = rows.findIndex((t) => t.includes(titleHigh));
    const iLow = rows.findIndex((t) => t.includes(titleLow));
    expect(iHigh, "la oferta de score 10 está en las filas").toBeGreaterThanOrEqual(0);
    expect(iHigh, "la oferta de score 10 va antes que la de 9").toBeLessThan(iLow);
    // El link de la fila lleva al detalle
    expect(await high.getByRole("link").getAttribute("href")).toMatch(/^\/jobs\/[0-9a-f-]{36}$/);

    // Visita anterior posterior a las evaluaciones: no hay nada nuevo que mostrar
    const stamp = nowSec() + 60;
    // Espera a que la visita ya haya escrito su cookie: así su respuesta no pisa la del test
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === VISIT_COOKIE))
      .toBe(true);
    await context.addCookies([
      { name: VISIT_COOKIE, value: `${E2E_USER_ID}.${stamp}.${stamp}`, url: baseURL! },
    ]);
    await page.goto("/hoy");
    await expect(page.getByTestId("hoy-visita")).toContainText("Tu última visita:");
    const fresh = page.getByTestId("hoy-nuevo");
    await expect(fresh.getByRole("heading", { name: "Lo nuevo para vos" })).toBeVisible();
    await expect(fresh.getByTestId("hoy-nuevo-fila")).toHaveCount(0);
    await expect(fresh).not.toContainText(titleHigh);
    // Con ofertas en la cuenta, el vacío es «Nada nuevo…»; si otro spec dejó ofertas en cola
    // para el usuario seed, el vacío correcto es el de la cola. Ninguno de los dos muestra filas
    const empty = fresh.locator(
      '[data-testid="hoy-vacio-nada-nuevo"], [data-testid="hoy-vacio-en-cola"]',
    );
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/Nada nuevo desde tu última visita|en cola/);

    // Una cookie de otra persona no sirve: vuelve el fallback de la semana
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === VISIT_COOKIE))
      .toBe(true);
    await context.addCookies([
      {
        name: VISIT_COOKIE,
        value: `${E2E_B_USER_ID}.${stamp}.${stamp}`,
        url: baseURL!,
      },
    ]);
    await page.goto("/hoy");
    await expect(
      page
        .getByTestId("hoy-nuevo")
        .getByRole("heading", { name: "Tus mejores ofertas de la semana" }),
    ).toBeVisible();
    await expect(page.getByTestId("hoy-nuevo")).toContainText(titleHigh);
  });

  test("una persona nueva ve «Todavía estamos leyendo» y nada de A", async ({ page }) => {
    await ensureSecondUser();
    await loginAsSecondUser(page);
    await expect(page).toHaveURL(/\/hoy$/);

    const card = page.getByTestId("hoy-nuevo");
    const empty = card.getByTestId("hoy-vacio-sin-ofertas");
    await expect(empty).toContainText("Todavía estamos leyendo ofertas para vos");
    // Sin carrera elegida, el paso siguiente es elegirla
    await expect(empty.getByRole("link", { name: "Elegí tu carrera" })).toHaveAttribute(
      "href",
      "/settings#puesto",
    );
    await expect(page.getByTestId("hoy-vacio-alertas")).toBeVisible();
    await expect(page.getByTestId("hoy-vacio-mercado")).toBeVisible();

    const html = await page.content();
    expect(html, "aparece una oferta de A").not.toContain(titleHigh);
    expect(html, "aparece una oferta de A").not.toContain(titleLow);
    expect(html, "aparece la empresa de A").not.toContain("E2E Testing SA");
  });

  test("A no ve nada de B en /hoy", async ({ page }) => {
    const b = await seedSecondUserData(tag);
    await login(page);
    await page.goto("/hoy");
    const html = await page.content();
    for (const secret of [b.title, b.company, b.jdToken, b.subject, b.domain]) {
      expect(html, `aparece "${secret}" de B`).not.toContain(secret);
    }
  });

  test("alertas: un mail de Indeed de ayer deja Indeed «activo» y los otros en «nunca»", async ({
    page,
  }) => {
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      const body = JSON.stringify({
        event: { data: { subject: "Aviso ficticio e2e 69" } },
        content: { text: "hola", html: null },
      });
      const [blob] = await db
        .insert(s.rawBlobs)
        .values({
          userId: E2E_B_USER_ID,
          kind: "inbound_email",
          contentType: "application/json",
          body,
          bytes: body.length,
        })
        .returning({ id: s.rawBlobs.id });
      await db.insert(s.inboundEmails).values({
        userId: E2E_B_USER_ID,
        fromAddress: "Indeed <alert@alert.indeed.com>",
        subject: "Aviso ficticio e2e 69",
        rawRef: `pg:${blob!.id}`,
        parser: "none",
        jobsExtracted: 0,
        error: null,
        receivedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
    } finally {
      await close();
    }

    await loginAsSecondUser(page);
    const card = page.getByTestId("hoy-alertas");
    await expect(card.getByTestId("hoy-vacio-alertas")).toHaveCount(0);
    await expect(card.getByTestId("hoy-alerta-indeed")).toHaveAttribute("data-status", "activo");
    await expect(card.getByTestId("hoy-alerta-indeed")).toContainText("Activo");
    await expect(card.getByTestId("hoy-alerta-linkedin")).toHaveAttribute("data-status", "nunca");
    await expect(card.getByTestId("hoy-alerta-getonboard")).toHaveAttribute("data-status", "nunca");
    await expect(card.getByRole("link", { name: "Ver la guía" })).toHaveAttribute(
      "href",
      "/settings/asistente",
    );
  });

  test("mercado: la carrera elegida muestra «N ofertas nuevas en 7 días»", async ({ page }) => {
    const original = await seedTargetRoles();
    try {
      await seedPublicJobs(tag, [
        {
          title: `Oferta Ficticia Mercado 1 ${tag}`,
          company: "Empresa Ficticia 1",
          sourceKind: "remoteok",
          roleHints: [MARKET_CAREER],
          lang: "es",
        },
        {
          title: `Oferta Ficticia Mercado 2 ${tag}`,
          company: "Empresa Ficticia 2",
          sourceKind: "jobicy",
          roleHints: [MARKET_CAREER],
          lang: "es",
        },
        {
          title: `Oferta Ficticia Mercado 3 ${tag}`,
          company: "Empresa Ficticia 3",
          sourceKind: "remoteok",
          roleHints: [MARKET_CAREER],
          lang: "en",
        },
      ]);
      await setSeedTargetRoles({ targetRoles: [MARKET_CAREER], targetRole: MARKET_CAREER });

      await login(page);
      const item = page.getByTestId("hoy-mercado").getByTestId(`hoy-mercado-${MARKET_CAREER}`);
      await expect(item).toBeVisible();
      await expect(item).toContainText(/\d+ ofertas? nuevas? en 7 días, \d+ en español/);
      await expect(item).not.toContainText("Todavía no hay ofertas públicas");
      await expect(item.getByRole("link", { name: /^Ver el mercado de / })).toHaveAttribute(
        "href",
        `/market?carrera=${MARKET_CAREER}`,
      );
      await expect(page.getByTestId("hoy-vacio-mercado")).toHaveCount(0);
    } finally {
      await deleteSeededPublicJobs(tag).catch(() => {});
      await setSeedTargetRoles(original);
    }
  });

  /** Deja el perfil seed con esos idiomas y carrera, corre `fn` y restaura todo al final. */
  async function withProfile(jobLanguages: string[], fn: () => Promise<void>): Promise<void> {
    const originalRoles = await seedTargetRoles();
    const { db, close } = ownerDb();
    let originalLanguages: string[] = ["es", "en"];
    try {
      const [row] = await db
        .select({ jobLanguages: s.profiles.jobLanguages })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      originalLanguages = row?.jobLanguages ?? originalLanguages;
      await db.update(s.profiles).set({ jobLanguages }).where(eq(s.profiles.userId, E2E_USER_ID));
      await setSeedTargetRoles({ targetRoles: [MARKET_CAREER], targetRole: MARKET_CAREER });
      await fn();
    } finally {
      await db
        .update(s.profiles)
        .set({ jobLanguages: originalLanguages })
        .where(eq(s.profiles.userId, E2E_USER_ID));
      await close();
      await setSeedTargetRoles(originalRoles);
    }
  }

  test("puente de idioma: solo español y menos de 5 ofertas en español muestra el link al perfil", async ({
    page,
  }) => {
    await withProfile(["es"], async () => {
      await login(page);
      const bridge = page
        .getByTestId("hoy-mercado")
        .getByTestId(`hoy-puente-idioma-${MARKET_CAREER}`);
      await expect(bridge).toBeVisible();
      await expect(bridge).toContainText(
        "Casi todo está en inglés. Si aceptás ofertas en los dos idiomas vas a ver más.",
      );
      await expect(bridge.getByRole("link", { name: "vas a ver más" })).toHaveAttribute(
        "href",
        "/settings/perfil",
      );
    });
  });

  test("puente de idioma: con español e inglés no aparece", async ({ page }) => {
    await withProfile(["es", "en"], async () => {
      await login(page);
      await expect(page.getByTestId(`hoy-mercado-${MARKET_CAREER}`)).toBeVisible();
      await expect(page.getByTestId(`hoy-puente-idioma-${MARKET_CAREER}`)).toHaveCount(0);
      await expect(page.getByTestId("hoy-mercado")).not.toContainText("Casi todo está en inglés");
    });
  });

  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    test(`a ${viewport.width} px no hay scroll horizontal y axe no encuentra violaciones`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await login(page);
      await expect(page.getByRole("heading", { level: 1, name: "Hoy", exact: true })).toBeVisible();
      await expect(page.getByTestId("hoy-nuevo-fila").first()).toBeVisible();
      if (viewport.width === 360) {
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width, "scrollWidth en /hoy").toBeLessThanOrEqual(360);
      }
      expect(await axeSummary(page), `Violaciones de axe en /hoy a ${viewport.width} px`).toEqual(
        [],
      );
    });
  }
});
