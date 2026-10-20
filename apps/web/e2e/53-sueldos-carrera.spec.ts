import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 53 (ronda 80): sueldos por carrera en dos segmentos (LatAm e internacional). Una persona
 * nueva ve en el paso 1 la línea corta de sueldos debajo de cada puesto y abre «Ver sueldos»; a
 * 360 px no hay scroll horizontal. En /market (con sesión) se ven los dos segmentos.
 *
 * El servidor cachea 30 minutos los sueldos y el pool del CI tiene pocos datos: se verifica la
 * estructura (la línea con número o con «pocos datos», los dos rótulos), nunca cifras exactas.
 * Todo es inventado; la persona se borra al final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 53: sueldos por carrera", () => {
  const tag = Date.now();
  const password = "sueldos-clave-local-53";
  const email = `sueldos-${tag}@onboarding.test`;
  let invitationId: string | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  test.afterAll(async () => {
    await context?.close().catch(() => {});
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email));
      if (user) {
        await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
            await deleteUserData(tx as never, user.id);
          })
          .catch(() => {});
        await db.delete(s.jobs).where(eq(s.jobs.userId, user.id));
      }
      if (invitationId) await db.delete(s.invitations).where(eq(s.invitations.id, invitationId));
    } finally {
      await close();
    }
  });

  test("onboarding: la línea de sueldos, «Ver sueldos» y 360 px sin scroll horizontal", async ({
    browser,
  }) => {
    const code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;
    } finally {
      await close();
    }
    context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    page = await context.newPage();
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Sueldos");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repetí la contraseña").fill(password);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Cuenta creada" })).toBeVisible();
    await page.getByRole("link", { name: "Ir a entrar" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL("**/onboarding**");

    // Una línea por puesto, con número o con «pocos datos»; nunca vacía
    const lines = page.locator('[data-testid^="career-salary-"][data-testid$="-line"]');
    await expect(lines.first()).toBeVisible();
    expect(await lines.count()).toBeGreaterThanOrEqual(1);
    await expect(lines.first()).toHaveText(
      /^LatAm: (típico USD [\d.]+\/mes · .+ ofertas con sueldo|Pocos datos todavía: .+ de 10 ofertas con sueldo publicado|Ninguna oferta publica sueldo todavía)$/,
    );

    // «Ver sueldos» se abre y muestra los dos segmentos
    const details = page.locator("details").filter({ hasText: "Ver sueldos" }).first();
    await details.getByText("Ver sueldos").click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(details).toContainText("Ofertas abiertas a Argentina / LatAm");
    await expect(details).toContainText("Ofertas internacionales");
    await expect(details).toContainText("Basado en ofertas publicadas en los últimos 30 días");

    // A 360 px la grilla de casillas no desborda
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      "sin scroll horizontal a 360 px",
    ).toBe(true);
  });

  test("/market: se ven los dos segmentos de sueldos", async ({ page: appPage }) => {
    await login(appPage);
    await appPage.goto("/market?carrera=backend");
    const block = appPage.getByTestId("market-salary");
    await expect(block).toBeVisible();
    await expect(block).toContainText("Ofertas abiertas a Argentina / LatAm");
    await expect(block).toContainText("Ofertas internacionales");
  });
});
