import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";
import { login, ownerDb } from "./helpers";

/**
 * Flujo 149 (R16-4): cobertura del pool por carrera en `/admin/metricas` (solo admin). Se siembran ofertas
 * inventadas de una carrera de la beta y se comprueba que los totales suben en la cantidad exacta (los números
 * de antes no importan: se leen antes y después). Que una cuenta común no la ve lo cubre el flujo 140
 * (`/admin/metricas` da 404); el desborde horizontal y axe, los flujos 102 y 77. No corre en local.
 */
test.describe.configure({ mode: "serial" });

const PREFIX = "cobertura-pool-e2e-";
const ROLE = "abogacia";
const DAY = 24 * 60 * 60 * 1000;

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  } finally {
    await close();
  }
}

async function seed(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const now = Date.now();
    const offer = (
      n: number,
      over: Partial<typeof s.publicJobs.$inferInsert> & { lastSeenAt: Date },
    ) => ({
      sourceKind: "wwr" as const,
      externalId: `${PREFIX}${n}`,
      sourceName: "We Work Remotely",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: `Puesto ficticio ${n}`,
      titleNormalized: `puesto ficticio ${n}`,
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      roleHints: [ROLE],
      firstSeenAt: new Date(now - 40 * DAY),
      ...over,
    });
    await db.insert(s.publicJobs).values([
      offer(1, { lastSeenAt: new Date(now - 1 * DAY), jdLanguage: "es" }), // 7 y 30, español
      offer(2, { lastSeenAt: new Date(now - 3 * DAY), jdLanguage: "en" }), // 7 y 30
      offer(3, { lastSeenAt: new Date(now - 15 * DAY), jdLanguage: "es" }), // solo 30, español
      offer(4, { lastSeenAt: new Date(now - 45 * DAY) }), // fuera de las dos ventanas
    ]);
  } finally {
    await close();
  }
}

test.describe("Flujo 149: cobertura del pool por carrera", () => {
  test.beforeAll(clean);
  test.afterAll(clean);

  test("el admin ve las 8 carreras y los totales suben con las ofertas sembradas", async ({
    page,
  }) => {
    await login(page);
    const response = await page.goto("/admin/metricas");
    test.skip(
      response?.status() === 404,
      "El usuario e2e no es admin en este entorno (ADMIN_EMAILS sin E2E_EMAIL): /admin/metricas da 404",
    );
    const panel = page.getByTestId("cobertura-pool");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("cobertura-carrera")).toHaveCount(8);
    // las definiciones están en la pantalla
    await expect(panel).toContainText("Activa");
    await expect(panel).toContainText("no cuándo se publicó");
    await expect(panel).toContainText("una vez en cada una");

    const card = panel.locator(`[data-role="${ROLE}"]`);
    const num = async (id: string) => Number(await card.getByTestId(id).innerText());
    const before = {
      t7: await num("cobertura-total-7"),
      t30: await num("cobertura-total-30"),
      e7: await num("cobertura-es-7"),
      e30: await num("cobertura-es-30"),
    };

    await seed();
    await page.reload();
    await expect(card.getByTestId("cobertura-total-30")).toBeVisible();
    expect(await num("cobertura-total-7")).toBe(before.t7 + 2);
    expect(await num("cobertura-total-30")).toBe(before.t30 + 3);
    expect(await num("cobertura-es-7")).toBe(before.e7 + 1);
    expect(await num("cobertura-es-30")).toBe(before.e30 + 2);
    // R19-04: casillas del pool con el estado del lector y una fila por carrera, sin remitentes
    const casillas = page.getByTestId("casillas-pool");
    await expect(casillas).toBeVisible();
    await expect(casillas.getByTestId("casillas-carrera")).toHaveCount(8);
    await expect(casillas.getByTestId("casillas-lector")).toHaveText(/Prendido|Apagado/);
    await expect(casillas).not.toContainText("@");
    // sin datos de ningún aviso en la pantalla
    await expect(panel).not.toContainText("Empresa Ficticia");
    await expect(panel).not.toContainText("example.com");
  });
});
