import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TERMS_VERSION } from "../lib/terms";
import { login, ownerDb } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";
import { buildPersona } from "./personas/personas";
import {
  cleanup,
  completeStep1,
  createInvitation,
  newRun,
  register,
  seedAndEvaluate,
  seedPool,
} from "./personas/flow";

/**
 * Flujo 278 (R28-04): el ensayo del alta completa con una persona nueva inventada (`r28-alta@example.com`),
 * de punta a punta y en un celular de 390 px:
 *   1. invitación · 2. registro · 3. términos · 4. onboarding con el CV de prueba · 5. primera oferta
 *   evaluada (modelo simulado, LLM_DEMO=1) · 6. «Ya pagué» · 7. el admin activa el plan · 8. Afi festeja.
 *
 * Decisiones:
 * - El «CV de prueba» (`fixtures/cv-r28-alta.txt`) entra por el resumen del paso 1 del onboarding, que es lo
 *   que el formulario pide siempre. La lectura del CV con el agente de perfil (flujo 135) está en `fixme` y
 *   depende de un flag, así que no se mete en el camino de apertura.
 * - Activar el plan no tiene festejo propio (no se inventa uno): el paso 8 verifica el festejo que sí existe
 *   en el recorrido de una persona nueva, el de marcar la primera postulación.
 * - Los pasos 6 y 7 necesitan `PRICING_ENABLED=1` y `MP_LINK_LISTA` (como el 157) y, el 7, `ADMIN_EMAILS`:
 *   sin eso se saltean con el motivo y corren en el CI.
 */
const PRICING_ON = process.env.PRICING_ENABLED === "1" && Boolean(process.env.MP_LINK_LISTA);
const ADMIN_ON = Boolean(process.env.ADMIN_EMAILS);
const EMAIL = "r28-alta@example.com";

const cv = readFileSync(join(__dirname, "fixtures", "cv-r28-alta.txt"), "utf8");
const CV_RESUMEN = cv
  .trim()
  .split(/\n\s*\n/)
  .at(-1)!
  .replace(/\s+/g, " ");

test.describe.configure({ mode: "serial" });

test.describe("Flujo 278: ensayo del alta completa (R28-04)", () => {
  const run = newRun("agustina");
  run.persona = { ...buildPersona("agustina", run.tag), email: EMAIL, summary: CV_RESUMEN };
  const ownTitle = run.persona.offers.find((o) => o.own)!.title;
  let context: BrowserContext | undefined;
  let page: Page;

  async function planDeLaPersona() {
    const { db, close } = ownerDb();
    try {
      const [p] = await db
        .select({ plan: s.profiles.plan, source: s.profiles.planSource })
        .from(s.profiles)
        .where(eq(s.profiles.userId, run.userId!));
      return p;
    } finally {
      await close();
    }
  }

  test.beforeAll(async ({ browser }) => {
    if (ADMIN_ON) await ensureSeedPerson();
    await createInvitation(run);
    await seedPool(run);
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (run.userId) {
      const { db, close } = ownerDb();
      try {
        await db.delete(s.paymentNotices).where(eq(s.paymentNotices.userId, run.userId));
      } finally {
        await close();
      }
    }
    await cleanup(run, context);
  });

  test("1 a 4: invitación, registro, términos y onboarding con el CV de prueba", async () => {
    test.setTimeout(180_000);
    // La invitación abre el registro y los términos se aceptan con la casilla (register la marca)
    await page.goto(`/register?code=${run.code}`);
    await expect(page.getByLabel(/Leí y acepto/)).toBeVisible();
    await register(page, run);
    await completeStep1(page, run);
    // Skills: se saltea (fillSkills compara el texto de la etiqueta con el catálogo, que una base local vieja
    // puede tener distinto); lo que prueba este flujo es el alta, no el catálogo
    await page.getByRole("button", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/ofertas**");
    await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();

    const { db, close } = ownerDb();
    try {
      const [u] = await db
        .select({ version: s.users.termsVersion, acceptedAt: s.users.termsAcceptedAt })
        .from(s.users)
        .where(eq(s.users.email, EMAIL));
      expect(u?.version).toBe(TERMS_VERSION);
      expect(u?.acceptedAt).not.toBeNull();
      const [p] = await db
        .select({ summary: s.profiles.profileSummary })
        .from(s.profiles)
        .where(eq(s.profiles.userId, run.userId!));
      expect(p?.summary).toContain("Contadora con cinco años");
    } finally {
      await close();
    }
  });

  test("5: la primera oferta se evalúa con el modelo simulado y Hoy dice qué mirar", async () => {
    await seedAndEvaluate(run);
    await page.goto("/jobs");
    const link = page.getByRole("link", { name: ownTitle }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });

    // Primera visita a Hoy: la oferta evaluada está arriba, con su puntaje y un link para abrirla
    await page.goto("/hoy");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Buen|Hola|¡/);
    const nuevo = page.getByTestId("hoy-nuevo");
    await expect(nuevo).toBeVisible();
    await expect(nuevo.getByRole("link").first()).toBeVisible();
  });

  test("6: «Ya pagué» con un número de operación inventado queda pendiente", async () => {
    test.skip(!PRICING_ON, "necesita PRICING_ENABLED=1 y MP_LINK_LISTA en el servidor de e2e (CI)");
    await page.goto("/settings");
    const box = page.getByTestId("ya-pague");
    await box.getByLabel("Número de operación (opcional)").fill("000000000028");
    await box.getByRole("button", { name: "Ya pagué" }).click();
    await expect(page.getByTestId("ya-pague-recibido")).toBeVisible();
    const { db, close } = ownerDb();
    try {
      const [n] = await db
        .select({ status: s.paymentNotices.status, op: s.paymentNotices.operationNumber })
        .from(s.paymentNotices)
        .where(eq(s.paymentNotices.userId, run.userId!));
      expect(n).toEqual({ status: "pendiente", op: "000000000028" });
    } finally {
      await close();
    }
  });

  test("7: el admin activa el plan desde la cola de altas", async ({ browser }) => {
    test.skip(!PRICING_ON, "necesita PRICING_ENABLED=1 y MP_LINK_LISTA en el servidor de e2e (CI)");
    test.skip(!ADMIN_ON, "sin ADMIN_EMAILS la cuenta del e2e no es admin (CI)");
    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const admin = await adminContext.newPage();
      await login(admin);
      const res = await admin.goto("/admin/planes");
      test.skip(res?.status() === 404, "El usuario e2e no es admin en este entorno");
      const aviso = admin
        .getByTestId("cola-avisos")
        .getByTestId("aviso-pendiente")
        .filter({ hasText: EMAIL });
      await expect(aviso).toContainText("operación 000000000028");
      await aviso.getByRole("button", { name: /Activar \d+ días/ }).click();
      await expect(admin.getByTestId("planes-ok")).toContainText("el aviso quedó activado");
    } finally {
      await adminContext.close();
    }
    expect(await planDeLaPersona()).toEqual({ plan: "lista", source: "pago" });
  });

  test("8: Afi festeja la primera postulación", async () => {
    await page.goto("/jobs");
    await page.getByRole("link", { name: ownTitle }).first().click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("festejo")).toHaveCount(0);
    await page.getByRole("button", { name: "Ya me postulé" }).click();
    const festejo = page.getByTestId("festejo");
    await expect(festejo).toBeVisible();
    await expect(festejo).toHaveAttribute("data-festejo", "postulacion");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
