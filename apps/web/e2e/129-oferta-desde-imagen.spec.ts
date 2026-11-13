import { jobs, llmCalls } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 129 (R6-3): cargar una oferta desde una imagen. El servidor corre con LLM_DEMO=1
 * (playwright.config.ts): la tarea `extract_job_from_image` responde un aviso inventado
 * («Empresa Demo A») sin llamar a ningún modelo, y queda en llm_calls con model = "fake".
 * La imagen es un PNG de 1×1 inventado. El título y la descripción se corrigen con un tag para
 * ubicar y borrar lo creado (y para no fusionarse con otra corrida por el texto).
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Flujo 129: oferta desde una imagen", () => {
  const tag = Date.now();
  const title = `E2E Imagen ${tag}`;
  let createdId: string | null = null;

  test.afterAll(async () => {
    if (createdId) {
      await deleteJob(createdId);
      return;
    }
    const { db, close } = ownerDb();
    try {
      const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.title, title));
      for (const r of rows) await deleteJob(r.id);
    } finally {
      await close();
    }
  });

  test("imagen → campos → revisar y confirmar → la oferta aparece en /jobs", async ({ page }) => {
    await login(page);
    await page.goto("/jobs/new?modo=pegar");
    await expect(page.getByRole("heading", { name: "O cargala desde una captura" })).toBeVisible();

    await page
      .getByLabel("Imagen del aviso")
      .setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG_1X1 });

    // Revisión: lo que leyó el demo, en los campos de siempre, con lo que no dice marcado
    await expect(page.getByRole("status").filter({ hasText: "Leímos 1 oferta" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByLabel("Empresa *", { exact: true })).toHaveValue("Empresa Demo A");
    await expect(page.getByText("la imagen no lo dice").first()).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Cargar esta oferta" })).toBeChecked();

    // Todavía no se creó nada: se corrige y recién ahí se confirma
    await page.getByLabel("Título *", { exact: true }).fill(title);
    await page
      .getByLabel(/^Descripción del puesto/)
      .fill(`Aviso inventado para el flujo 129 (${tag}).`);
    await page.getByRole("button", { name: "Cargar la oferta elegida" }).click();

    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}/);
    createdId = /\/jobs\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? null;
    expect(createdId).not.toBeNull();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.goto("/jobs");
    await expect(page.getByText(title).first()).toBeVisible();

    // Quedó registrada la llamada (cuenta para el tope de 10 por día) y fue la demo, no un modelo
    const { db, close } = ownerDb();
    try {
      const calls = await db
        .select({ id: llmCalls.id })
        .from(llmCalls)
        .where(and(eq(llmCalls.task, "extract_job_from_image"), eq(llmCalls.model, "fake")));
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await close();
    }
  });

  test("un archivo que no es PNG, JPG ni WebP se rechaza sin llamar al servidor", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs/new?modo=pegar");
    await page.getByLabel("Imagen del aviso").setInputFiles({
      name: "nota.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("no soy una imagen"),
    });
    // Playwright ve DOS role=alert: el nuestro y el route-announcer de Next; se acota a <main>
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "tiene que ser PNG, JPG o WebP",
    );
    await expect(page.getByRole("status").filter({ hasText: "Leímos" })).toHaveCount(0);
  });
});
