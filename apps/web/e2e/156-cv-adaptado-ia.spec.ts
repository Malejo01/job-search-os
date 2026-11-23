import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 156 (R20-04): versión del CV adaptada con IA, con el modelo simulado (`LLM_DEMO=1`, sin red ni gasto).
 * Persona B (de prueba, con `CV_TAILOR=testers`) con un CV inventado de tres viñetas y dos ofertas suyas.
 *
 * - Oferta normal: el modelo simulado devuelve las viñetas en orden inverso; la verificación la acepta, se
 *   muestra «qué cambió y por qué» y lo que queda es solo texto del CV de la persona.
 * - Oferta con la marca `DEMO_INVENTA`: el modelo simulado inventa un número y una empresa; la verificación
 *   descarta la versión y la pantalla dice que sigue la versión sin IA. Nada inventado llega a la pantalla.
 * - Tope de 3 por día: la cuarta se frena con un mensaje claro.
 *
 * Supone que el panel `CvTailorPanel` está montado en «Preparar mi postulación» (`/jobs/<id>/postular`, R20-05).
 * Se saltea si el server de e2e no tiene `CV_TAILOR=testers` (playwright.config.ts exporta `E2E_CV_TAILOR_MODE`).
 */
const testersMode = process.env.E2E_CV_TAILOR_MODE === "testers";
const TAG = `156-${Date.now()}`;
const BULLETS = [
  "Armé reportes mensuales de ventas",
  "Coordiné pedidos de datos con 4 áreas",
  "Automaticé la carga de datos con SQL",
];

test.describe.configure({ mode: "serial" });
test.skip(!testersMode, "El server de e2e no está en CV_TAILOR=testers");

let normalJobId = "";
let inventsJobId = "";

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv_tailor:%")));
  } finally {
    await close();
  }
}

async function addJob(title: string, jdText: string): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: E2E_B_USER_ID,
        companyRaw: `Empresa B ${TAG}`,
        title,
        titleNormalized: title.toLowerCase(),
        canonicalUrl: `https://example.com/e2e-156/${TAG}/${encodeURIComponent(title)}`,
        status: "evaluada",
        jdText,
        flags: [],
        firstSeenAt: new Date(),
      })
      .returning({ id: s.jobs.id });
    return job!.id;
  } finally {
    await close();
  }
}

async function expectNoOverflowNorAxe(page: Page): Promise<void> {
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

test.beforeAll(async () => {
  if (!testersMode) return;
  await ensureSecondUser();
  const { db, close } = ownerDb();
  try {
    await db.insert(s.careerHistory).values({
      userId: E2E_B_USER_ID,
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2022-01",
      bullets: BULLETS,
    });
  } finally {
    await close();
  }
  normalJobId = await addJob(`Analista de datos ${TAG}`, "Pedimos SQL y Excel.");
  inventsJobId = await addJob(`Analista inventa ${TAG}`, "Pedimos SQL. DEMO_INVENTA");
  await clean();
});

test.afterAll(async () => {
  if (!testersMode) return;
  await clean();
  const { db, close } = ownerDb();
  try {
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
  await removeSecondUser();
});

test.beforeEach(async () => {
  if (testersMode) await clean();
});

test("la versión adaptada se verifica y muestra qué cambió y por qué", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsSecondUser(page);
  await page.goto(`/jobs/${normalJobId}/postular`);
  const panel = page.getByTestId("cv-tailor");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("No agrega experiencias, números ni herramientas");

  await page.getByTestId("cv-tailor-button").click();
  const result = page.getByTestId("cv-tailor-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("cada dato sale de lo que ya confirmaste");
  await expect(result.getByText("Qué cambió y por qué")).toBeVisible();
  await expect(result.getByText("Cómo queda")).toBeVisible();

  // El modelo simulado da vuelta las viñetas: la primera ahora es la última del CV, y todas son del CV
  const items = result.locator("ul").last().getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.first()).toHaveText(BULLETS[2]!);
  await expect(items.last()).toHaveText(BULLETS[0]!);
  await expect(result).not.toContainText("Empresa Zeta");
  await expectNoOverflowNorAxe(page);

  // Un llamado del modelo simulado: costo 0 y etiquetado para el cupo
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select()
      .from(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), eq(s.llmCalls.task, "cv_tailor")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe("fake");
    expect(Number(rows[0]?.costUsd ?? 0)).toBe(0);
  } finally {
    await close();
  }
});

test("si el modelo inventa un dato se descarta y sigue la versión sin IA", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto(`/jobs/${inventsJobId}/postular`);
  await page.getByTestId("cv-tailor-button").click();
  const error = page.getByTestId("cv-tailor-error");
  await expect(error).toBeVisible();
  await expect(error).toContainText("traía datos que no están en tu CV");
  await expect(error).toContainText("versión sin IA");
  await expect(page.getByTestId("cv-tailor-result")).toHaveCount(0);
  await expect(page.getByText("Empresa Zeta")).toHaveCount(0);
  await expect(page.getByText("50 personas")).toHaveCount(0);
});

test("la versión adaptada se descarga como .docx y no hay descarga antes de pedirla", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto(`/jobs/${normalJobId}/postular`);
  await expect(page.getByTestId("descargar-cv-adaptado")).toHaveCount(0);
  await page.getByTestId("cv-tailor-button").click();
  await expect(page.getByTestId("cv-tailor-result")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("descargar-cv-adaptado").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^CV-[A-Za-z0-9-]+\.docx$/);
});

test("un POST con una propuesta basura cae a la versión sin IA", async ({ page }) => {
  await loginAsSecondUser(page);
  const res = await page.request.post(`/jobs/${normalJobId}/postular/descargar`, {
    form: {
      proposal: '{"entries":[{"ref":"x","bullets":["Dato inventado"]}],"skills":[],"changes":[]}',
    },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("wordprocessingml.document");
  expect((await res.body()).subarray(0, 2).toString("latin1")).toBe("PK");
});

test("el cuarto pedido del día se frena con un mensaje claro", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto(`/jobs/${normalJobId}/postular`);
  for (let n = 1; n <= 3; n++) {
    await page.getByTestId("cv-tailor-button").click();
    await expect(page.getByTestId("cv-tailor-result")).toBeVisible();
    await expect(page.getByTestId("cv-tailor-button")).toHaveText("Armar la versión adaptada");
  }
  await page.getByTestId("cv-tailor-button").click();
  const error = page.getByTestId("cv-tailor-error");
  await expect(error).toContainText("Ya pediste 3 versiones adaptadas en las últimas 24 horas");
});
