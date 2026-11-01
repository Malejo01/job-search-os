import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { E2E_EMAIL, E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 91 (C3-1): planes de la beta desde el panel de admin y vigencia del acceso. La cuenta del e2e es
 * admin en el CI (`ADMIN_EMAILS` incluye `E2E_EMAIL` y el seed la carga en `app_admins`); si en otro entorno
 * no lo es, el panel da su mensaje de «función de administración» y los casos se saltean. El aviso de los
 * últimos 3 días y «Tu plan» dependen de `PRICING_ENABLED=1` (apagado en el CI), así que esos casos corren
 * en local con la variable encendida, como el 71. Siempre se deja a la cuenta en «gratis».
 */
const PRICING_ON = process.env.PRICING_ENABLED === "1";
const DAY = 86_400_000;

async function setPlan(
  plan: "gratis" | "lista",
  source: "pago" | "beca" | null,
  until: Date | null,
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.profiles)
      .set({ plan, planSource: source, planUntil: until })
      .where(eq(s.profiles.userId, E2E_USER_ID));
  } finally {
    await close();
  }
}

async function readPlan() {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({
        plan: s.profiles.plan,
        source: s.profiles.planSource,
        until: s.profiles.planUntil,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_USER_ID));
    return row;
  } finally {
    await close();
  }
}

async function abrirPanel(page: Page): Promise<boolean> {
  await login(page);
  await page.goto("/settings/planes");
  await expect(page.getByRole("heading", { level: 1, name: "Planes de la beta" })).toBeVisible();
  return (await page.getByRole("heading", { name: /^Activar \d+ días$/ }).count()) > 0;
}

test.describe("Flujo 91: planes de la beta", () => {
  test.afterEach(async () => {
    await setPlan("gratis", null, null);
  });

  test("el admin activa 30 días como becado, lo ve en la lista y lo quita", async ({ page }) => {
    test.skip(!(await abrirPanel(page)), "La cuenta del e2e no es admin en este entorno");
    await page.getByLabel("Email de la persona").fill(E2E_EMAIL);
    await page.getByLabel(/Becado/).check();
    await page.getByRole("button", { name: /^Activar \d+ días$/ }).click();
    await expect(page.getByTestId("planes-ok")).toContainText("becado");

    const saved = await readPlan();
    expect(saved?.plan).toBe("lista");
    expect(saved?.source).toBe("beca");
    // 30 días desde ahora, o desde la apertura de la beta si todavía no abrió: nunca menos de 29
    expect(saved?.until && saved.until.getTime() - Date.now()).toBeGreaterThan(29 * DAY);

    const fila = page.getByTestId("planes-lista").getByRole("listitem").filter({
      hasText: E2E_EMAIL,
    });
    await expect(fila).toContainText("Becado");
    await expect(fila).toContainText(/Hasta el .+ \(faltan \d+ días\)/);

    await fila.getByText("Quitar el plan").click();
    await fila.getByRole("button", { name: "Sí, quitar el plan" }).click();
    await expect(page.getByTestId("planes-ok")).toContainText("plan gratis");
    expect((await readPlan())?.plan).toBe("gratis");
  });

  test("renovar antes de que venza suma los días y un email inexistente no activa nada", async ({
    page,
  }) => {
    const inicio = new Date(Date.now() + 10 * DAY);
    await setPlan("lista", "pago", inicio);
    test.skip(!(await abrirPanel(page)), "La cuenta del e2e no es admin en este entorno");

    await page.getByLabel("Email de la persona").fill(E2E_EMAIL);
    await page.getByRole("button", { name: /^Activar \d+ días$/ }).click();
    await expect(page.getByTestId("planes-ok")).toContainText("pago");
    const renovado = await readPlan();
    // Los 10 días que le quedaban más 30 nuevos (la apertura de la beta solo puede correr el inicio)
    expect(renovado?.until && renovado.until.getTime()).toBeGreaterThanOrEqual(
      inicio.getTime() + 30 * DAY - 1000,
    );

    await page.getByLabel("Email de la persona").fill("nadie-existe@ejemplo.test");
    await page.getByRole("button", { name: /^Activar \d+ días$/ }).click();
    await expect(page.getByTestId("planes-error")).toContainText("No encontramos a esa persona");
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`axe del panel en ${tema} a 360 px`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
      test.skip(!(await abrirPanel(page)), "La cuenta del e2e no es admin en este entorno");
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    });
  }

  test("con 2 días por delante avisa en la app y en Ajustes; vencido, lo dice sin borrar nada", async ({
    page,
  }) => {
    test.skip(!PRICING_ON, "PRICING_ENABLED apagado en este entorno");
    await setPlan("lista", "beca", new Date(Date.now() + 2 * DAY));
    await login(page);
    await page.goto("/hoy");
    await expect(page.getByTestId("aviso-plan")).toContainText("Te quedan 2 días");
    await page.goto("/settings");
    await expect(page.getByTestId("tu-plan")).toContainText("beca: primer mes gratis");
    await expect(page.getByTestId("plan-por-vencer")).toBeVisible();

    await setPlan("lista", "beca", new Date(Date.now() - DAY));
    await page.goto("/hoy");
    await expect(page.getByTestId("aviso-plan")).toContainText("venció");
    await expect(page.getByTestId("aviso-plan")).toContainText("Tus datos siguen guardados");
    await page.goto("/settings");
    await expect(page.getByTestId("plan-vencido")).toBeVisible();

    // Con más de 3 días no hay aviso
    await setPlan("lista", "pago", new Date(Date.now() + 20 * DAY));
    await page.goto("/hoy");
    await expect(page.getByTestId("aviso-plan")).toHaveCount(0);
  });
});
