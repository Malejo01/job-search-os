import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_USER_ID,
  createEvaluation,
  deleteSeededPublicJobs,
  login,
  ownerDb,
  seedPublicJobs,
} from "./helpers";

/**
 * Flujo 352 (R30-07): si la oferta viene del pool y la fuente ya no la muestra, la tarjeta dice «Este
 * aviso ya no figura en {fuente}» y baja en la lista; de una que no viene del pool no se afirma nada.
 * Datos inventados.
 */
test.describe("Flujo 352: vigencia", () => {
  const tag = Date.now();
  const titleGone = `Oferta ficticia cerrada ${tag}`;
  const titleLive = `Oferta ficticia vigente ${tag}`;
  const jobIds: string[] = [];

  test.beforeAll(async () => {
    const [goneId, liveId] = await seedPublicJobs(tag, [
      { sourceKind: "remoteok", title: titleGone, company: "Empresa A", roleHints: [] },
      { sourceKind: "remoteok", title: titleLive, company: "Empresa B", roleHints: [] },
    ]);
    const { db, close } = ownerDb();
    try {
      // La fuente dejó de ver el primero hace 30 días; el otro (y el pool) se vieron recién
      await db
        .update(s.publicJobs)
        .set({ lastSeenAt: new Date(Date.now() - 30 * 86_400_000) })
        .where(eq(s.publicJobs.id, goneId!));
      for (const [publicJobId, title] of [
        [goneId!, titleGone],
        [liveId!, titleLive],
      ] as const) {
        const [job] = await db
          .insert(s.jobs)
          .values({
            userId: E2E_USER_ID,
            companyRaw: "Empresa A",
            title,
            titleNormalized: title.toLowerCase(),
            canonicalUrl: `https://example.com/e2e-vigencia/${tag}/${publicJobId}`,
            publicJobId,
            status: "evaluada",
            jdText: "JD ficticia.",
            flags: [],
          })
          .returning({ id: s.jobs.id });
        jobIds.push(job!.id);
        await createEvaluation(job!.id, { score: 6, accion: "guardar" });
      }
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    await deleteSeededPublicJobs(tag);
  });

  test("la tarjeta dice que el aviso ya no figura y baja; la vigente no dice nada", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const gone = page.getByRole("listitem").filter({ hasText: titleGone });
    await expect(gone.getByTestId("tarjeta-ya-no-figura")).toContainText(
      "Este aviso ya no figura en",
    );
    const live = page.getByRole("listitem").filter({ hasText: titleLive });
    await expect(live.getByTestId("tarjeta-ya-no-figura")).toHaveCount(0);
    // Baja, pero no se esconde
    const titles = await page.getByTestId("tarjeta-titulo").allTextContents();
    expect(titles.indexOf(titleGone)).toBeGreaterThan(titles.indexOf(titleLive));
  });
});
