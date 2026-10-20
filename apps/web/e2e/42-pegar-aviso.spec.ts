import { jobs } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 42 (ronda 63): cargar una oferta pegando el aviso entero. Datos inventados; el título
 * lleva Date.now() para ubicar y borrar lo creado.
 */
test.describe("Flujo 42: pegar el aviso entero", () => {
  const tag = Date.now();
  const title = `E2E Analista Pegado ${tag}`;
  let createdId: string | null = null;

  test.afterAll(async () => {
    if (createdId) {
      await deleteJob(createdId);
      return;
    }
    // Si el test falló después de guardar, se busca por título
    const { db, close } = ownerDb();
    try {
      const rows = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.title, title));
      for (const r of rows) await deleteJob(r.id);
    } finally {
      await close();
    }
  });

  test("leer el aviso completa los campos, se corrigen y se guarda", async ({ page }) => {
    await login(page);
    await page.goto("/jobs/pending-jd");
    await page.getByRole("link", { name: "Cargala a mano" }).click();
    await page.waitForURL("**/jobs/new?modo=pegar");
    await expect(page.getByRole("link", { name: "Pegar el aviso entero" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const aviso = [
      `Puesto: ${title}`,
      "Empresa: Empresa Ficticia E2E",
      "Ubicación: Buenos Aires, Argentina",
      "Modalidad: Remoto",
      "",
      "Acerca del empleo",
      "Buscamos una persona para analizar datos de ventas, armar tableros y comunicar hallazgos al equipo comercial. Requisitos: SQL, planillas, comunicación clara. Trabajo remoto para Argentina, contrato full time.",
    ].join("\n");
    const read = page.getByRole("button", { name: "Leer el aviso" });
    await expect(read).toBeDisabled();
    await page.getByLabel("Pegá el aviso completo (título, empresa, descripción…)").fill(aviso);
    await read.click();

    await expect(page.getByRole("status")).toContainText("Completamos 4 de 4 campos");
    await expect(page.getByLabel("Título *")).toHaveValue(title);
    await expect(page.getByLabel("Empresa *")).toHaveValue("Empresa Ficticia E2E");
    await expect(page.getByLabel("Ubicación")).toHaveValue("Buenos Aires, Argentina");
    await expect(page.getByLabel("Modalidad")).toHaveValue("remoto");
    await expect(page.getByLabel(/^Descripción del puesto/)).toHaveValue(aviso);

    await page.getByLabel("Empresa *").fill("Empresa Ficticia E2E corregida");
    await page.getByRole("button", { name: "Guardar oferta" }).click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}/);
    createdId = /\/jobs\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? null;
    expect(createdId).not.toBeNull();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Como en el flujo 2: evaluación demo al instante o, si todavía corre, el estado "evaluando"
    await expect(
      page.getByText("DEMO · evaluación falsa").or(page.getByText(/evaluando/i).first()),
    ).toBeVisible({ timeout: 30_000 });
  });
});
