import { expect, test } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { createJob, deleteJob, login, ownerDb } from "./helpers";

async function applicationOutcome(jobId: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ outcome: s.applications.outcome })
      .from(s.applications)
      .where(eq(s.applications.jobId, jobId));
    return row?.outcome ?? null;
  } finally {
    await close();
  }
}

test.describe("Flujo 4: postular → resultado (feedback loop, JS-036)", () => {
  let jobId: string;
  const title = `E2E postulación ${Date.now()}`;

  test.beforeAll(async () => {
    jobId = await createJob({ title, status: "evaluada", jdText: "JD de prueba." });
  });
  test.afterAll(async () => {
    await deleteJob(jobId);
  });

  test("aplicar crea la postulación; el resultado se cambia en /applications y con los eventos del detalle", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "Marcar aplicada" }).click();
    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();
    expect(await applicationOutcome(jobId)).toBe("sin_respuesta");

    await page.goto("/applications");
    const card = page.locator("li", { hasText: title });
    await expect(card).toBeVisible();
    await card.getByLabel("Resultado").selectOption("rechazo_humano");
    await card.getByPlaceholder("Nota (opcional)").fill("respondieron que buscan senior");
    await card.getByRole("button", { name: "Guardar resultado" }).click();
    await expect(card.locator("span", { hasText: "Rechazo humano" })).toBeVisible();
    await expect(card.getByText("respondieron que buscan senior")).toBeVisible();
    expect(await applicationOutcome(jobId)).toBe("rechazo_humano");

    // El evento sobre la oferta también deja el resultado en la postulación
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "Entrevista" }).click();
    await expect(page.getByText("Entrevista", { exact: true }).first()).toBeVisible();
    await expect.poll(() => applicationOutcome(jobId)).toBe("entrevista");
  });
});
