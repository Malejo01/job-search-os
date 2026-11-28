import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { ownerDb } from "./helpers";

/**
 * Flujo 157 (R22-01): «Ya pagué» en «Tu plan» de Ajustes. Con el link de pago visible, la persona avisa que
 * pagó (con un número de operación opcional), ve que el aviso quedó pendiente y no puede abrir un cuarto.
 *
 * Necesita `PRICING_ENABLED=1` y un `MP_LINK_LISTA` válido en el servidor de e2e: el CI no los tiene y el
 * flujo se saltea, igual que el 151. Crea su propia persona (inventada) y la borra al final: la base local
 * no tiene los usuarios del seed.
 */
const ON = process.env.PRICING_ENABLED === "1" && Boolean(process.env.MP_LINK_LISTA);
const EMAIL = "usuario-pago@ejemplo.test";
const PASSWORD = "dev-password-pago-local";
const USER_ID = "c0000000-0000-4000-8000-000000000157";

async function ensureUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: USER_ID,
        email: EMAIL,
        name: "Persona Pago",
        passwordHash: hashPassword(PASSWORD),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: USER_ID,
        displayName: "Persona Pago",
        locationCountry: "AR",
        careerAskedAt: new Date(), // R32-01: sin puestos, ya «pedida»
        inboundAddress: "u_pago_157@ingest.test",
        profileSummary:
          "Perfil ficticio de la persona del flujo 157. No corresponde a nadie real y solo existe en la base local.",
      })
      .onConflictDoNothing();
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, USER_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: USER_ID, version: 1, active: true, rules: {} as never });
    }
    await db.delete(s.paymentNotices).where(eq(s.paymentNotices.userId, USER_ID));
  } finally {
    await close();
  }
}

async function removeUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.paymentNotices).where(eq(s.paymentNotices.userId, USER_ID));
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, USER_ID));
    await db.delete(s.profiles).where(eq(s.profiles.userId, USER_ID));
    await db.delete(s.users).where(eq(s.users.id, USER_ID));
  } finally {
    await close();
  }
}

async function noticesOf(): Promise<{ status: string; operationNumber: string | null }[]> {
  const { db, close } = ownerDb();
  try {
    return await db
      .select({
        status: s.paymentNotices.status,
        operationNumber: s.paymentNotices.operationNumber,
      })
      .from(s.paymentNotices)
      .where(eq(s.paymentNotices.userId, USER_ID))
      .orderBy(s.paymentNotices.createdAt);
  } finally {
    await close();
  }
}

async function loginAsPayer(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/hoy**");
}

test.describe("Flujo 157: «Ya pagué»", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!ON, "necesita PRICING_ENABLED=1 y MP_LINK_LISTA en el servidor de e2e");

  test.beforeAll(ensureUser);
  test.afterAll(removeUser);

  test("avisa con número de operación, queda pendiente y se ve como pendiente", async ({
    page,
  }) => {
    await loginAsPayer(page);
    await page.goto("/settings");
    const box = page.getByTestId("ya-pague");
    await expect(page.getByRole("link", { name: /Pagar con Mercado Pago/ })).toBeVisible();
    await expect(box.getByText(/no guardamos datos de tu tarjeta/i)).toBeVisible();
    await box.getByLabel("Número de operación (opcional)").fill("123456789012");
    await box.getByRole("button", { name: "Ya pagué" }).click();
    await expect(page.getByTestId("ya-pague-recibido")).toHaveText(
      "Recibimos tu aviso: lo confirmamos a mano en menos de 24 h.",
    );
    expect(await noticesOf()).toEqual([{ status: "pendiente", operationNumber: "123456789012" }]);

    // Al volver a entrar, el aviso se muestra como pendiente (no se esconde)
    await page.goto("/settings");
    await expect(page.getByTestId("ya-pague-pendiente")).toContainText("aviso de pago pendiente");
  });

  test("con el número vacío también vale, y el cuarto aviso no se crea", async ({ page }) => {
    await loginAsPayer(page);
    for (let i = 0; i < 2; i++) {
      await page.goto("/settings");
      await page.getByTestId("ya-pague").getByRole("button", { name: "Ya pagué" }).click();
      await expect(page.getByTestId("ya-pague-recibido")).toBeVisible();
    }
    expect((await noticesOf()).map((n) => n.operationNumber)).toEqual(["123456789012", null, null]);

    // Con 3 pendientes ya no se ofrece otro aviso y se explica
    await page.goto("/settings");
    await expect(page.getByTestId("ya-pague-pendiente")).toContainText("Ya tenés 3 avisos");
    await expect(
      page.getByTestId("ya-pague").getByRole("button", { name: "Ya pagué" }),
    ).toHaveCount(0);
    expect(await noticesOf()).toHaveLength(3);
  });
});
