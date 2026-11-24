import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { login, ownerDb } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";

/**
 * Flujo 165 (R22-02): cola de altas en `/admin/planes` (solo admin). El spec crea dos personas ficticias,
 * cada una con un aviso «Ya pagué» pendiente: activa uno (queda con el plan de la beta y el aviso sale de
 * la cola) y rechaza el otro con un motivo. Comprueba además la búsqueda por email y el historial. Una
 * cuenta común no entra: lo cubre el 123 (404 de las pantallas de admin).
 */
test.describe.configure({ mode: "serial" });

const ID = (n: number) => `e9650000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PAYER = ID(1);
const REJECTED = ID(2);
const PEOPLE = [PAYER, REJECTED];
const EMAIL = (id: string) => `cola-altas-${id.slice(-1)}@example.com`;

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.paymentNotices).where(inArray(s.paymentNotices.userId, PEOPLE));
    await db.delete(s.profiles).where(inArray(s.profiles.userId, PEOPLE));
    await db.delete(s.users).where(inArray(s.users.id, PEOPLE)); // el historial cae en cascada
  } finally {
    await close();
  }
}

async function seed(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    for (const id of PEOPLE) {
      await db.insert(s.users).values({ id, email: EMAIL(id), name: "Persona ficticia" });
      await db.insert(s.profiles).values({
        userId: id,
        displayName: "Persona ficticia",
        locationCountry: "AR",
        inboundAddress: `cola-altas-e2e-${id.slice(-1)}`,
      });
      await db
        .insert(s.paymentNotices)
        .values({ userId: id, plan: "lista", operationNumber: "123456789" });
    }
  } finally {
    await close();
  }
}

async function planOf(id: string) {
  const { db, close } = ownerDb();
  try {
    const [p] = await db
      .select({ plan: s.profiles.plan, source: s.profiles.planSource })
      .from(s.profiles)
      .where(eq(s.profiles.userId, id));
    const [n] = await db
      .select({ status: s.paymentNotices.status, reason: s.paymentNotices.rejectReason })
      .from(s.paymentNotices)
      .where(eq(s.paymentNotices.userId, id));
    return { ...p, notice: n };
  } finally {
    await close();
  }
}

test.describe("Flujo 165: cola de altas", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
  test.beforeAll(async () => {
    // La persona de prueba (admin) la crea el helper si la base local no trae al usuario del seed (R26-07)
    await ensureSeedPerson();
    await clean();
    await seed();
  });
  test.afterAll(clean);

  test("activa un aviso, rechaza otro con motivo y quedan en el historial", async ({ page }) => {
    await login(page);
    const response = await page.goto("/admin/planes");
    test.skip(response?.status() === 404, "El usuario e2e no es admin en este entorno");

    const queue = page.getByTestId("cola-avisos");
    const payer = queue.getByTestId("aviso-pendiente").filter({ hasText: EMAIL(PAYER) });
    const rejected = queue.getByTestId("aviso-pendiente").filter({ hasText: EMAIL(REJECTED) });
    await expect(payer).toContainText("operación 123456789");

    await payer.getByRole("button", { name: /Activar \d+ días/ }).click();
    await expect(page.getByTestId("planes-ok")).toContainText("el aviso quedó activado");
    await expect(queue).not.toContainText(EMAIL(PAYER));
    expect(await planOf(PAYER)).toMatchObject({
      plan: "lista",
      source: "pago",
      notice: { status: "activado" },
    });

    await rejected.getByText("Rechazar", { exact: true }).click();
    await rejected.getByLabel("Motivo (corto)").fill("No vimos el pago");
    await rejected.getByRole("button", { name: "Rechazar aviso" }).click();
    await expect(page.getByTestId("planes-ok")).toContainText("el aviso quedó rechazado");
    expect((await planOf(REJECTED)).notice).toEqual({
      status: "rechazado",
      reason: "No vimos el pago",
    });
    expect((await planOf(REJECTED)).plan).toBe("gratis");

    // Historial: las dos acciones, y la lista de planes se busca por email
    const historial = page.getByTestId("historial-plan");
    await expect(historial).toContainText(EMAIL(PAYER));
    await expect(historial).toContainText("Activado");
    await expect(historial).toContainText("Aviso rechazado");

    await page.goto(`/admin/planes?q=${encodeURIComponent("cola-altas-1")}`);
    const lista = page.getByTestId("planes-lista");
    await expect(lista).toContainText(EMAIL(PAYER));
    await expect(lista.getByRole("button", { name: /Renovar \+\d+ días/ })).toHaveCount(1);
    await page.goto("/admin/planes?q=no-existe-nadie-asi");
    await expect(page.getByTestId("planes-sin-resultados")).toBeVisible();
  });
});
