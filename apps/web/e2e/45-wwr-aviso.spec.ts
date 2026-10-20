import { jobSources, jobs } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { E2E_USER_ID, deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 45 (ronda 67): un aviso de We Work Remotely muestra el aviso del muro de pago y, si la JD
 * trae el link al sitio de empleos de la empresa, el link para postular ahí. Datos inventados.
 */
test.describe("Flujo 45: aviso de We Work Remotely", () => {
  const tag = Date.now();
  const title = `E2E Aviso WWR ${tag}`;
  let jobId: string | null = null;

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("se ven el aviso y el link al sitio de la empresa", async ({ page }) => {
    const { db, close } = ownerDb();
    try {
      const [job] = await db
        .insert(jobs)
        .values({
          userId: E2E_USER_ID,
          companyRaw: "Empresa Ficticia E2E",
          title,
          titleNormalized: title.toLowerCase(),
          canonicalUrl: `https://example.com/e2e/wwr-${tag}`,
          locationRaw: "Remoto (Argentina)",
          modality: "remoto",
          status: "prefiltrada",
          jdText:
            "Puesto ficticio para el e2e.\n\nSitio de empleos de la empresa: https://jobs.lever.co/empresa-ficticia/123",
          flags: [],
          firstSeenAt: new Date(),
        })
        .returning({ id: jobs.id });
      jobId = job!.id;
      await db.insert(jobSources).values({
        jobId,
        kind: "wwr",
        sourceName: "e2e",
        url: `https://example.com/e2e/wwr-${tag}`,
        seenAt: new Date(),
      });
    } finally {
      await close();
    }

    await login(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText(/We Work Remotely pide una suscripción paga/)).toBeVisible();
    const link = page.getByRole("link", { name: /Postular en el sitio de la empresa \(Lever\)/ });
    await expect(link).toHaveAttribute("href", "https://jobs.lever.co/empresa-ficticia/123");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
