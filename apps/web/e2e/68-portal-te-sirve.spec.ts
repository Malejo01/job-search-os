import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import {
  closePrivacyDialog,
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 68: «Qué portal te sirve» en Ajustes › Reenvío de emails. Usa a la persona B y la borra al
 * terminar (con sus ofertas, fuentes, evaluaciones y postulaciones por cascade).
 *  - Fuente A (Remote OK): 6 ofertas, 2 con puntaje 8, 1 aplicada y 1 en entrevista.
 *  - Fuente B (LinkedIn): 2 ofertas → «pocos datos».
 */
test.describe("Flujo 68: qué portal te sirve", () => {
  test.beforeAll(async () => {
    // Si una corrida anterior murió antes del afterAll, se empieza de cero
    await removeSecondUser();
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      const seed = async (
        kind: "remoteok" | "email_linkedin",
        i: number,
        status: "nueva" | "entrevista" | "aplicada" = "nueva",
      ) => {
        const [job] = await db
          .insert(s.jobs)
          .values({
            userId: E2E_B_USER_ID,
            companyRaw: "Empresa B e2e 68",
            title: `Oferta ficticia 68 ${kind} ${i}`,
            titleNormalized: `oferta ficticia 68 ${kind} ${i}`,
            canonicalUrl: `https://example.com/e2e68/${kind}/${i}`,
            status,
            flags: [],
            firstSeenAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          })
          .returning({ id: s.jobs.id });
        await db.insert(s.jobSources).values({ jobId: job!.id, kind, sourceName: "e2e 68" });
        return job!.id;
      };
      const evaluate = (jobId: string, score: number) =>
        db.insert(s.evaluations).values({
          jobId,
          userId: E2E_B_USER_ID,
          criteriaVersion: 1,
          promptVersion: "evaluate_job@e2e",
          model: "fake",
          hadFullJd: true,
          score,
          locationOk: "ok",
          modality: "remoto",
          discipline: "ai_engineer",
          matchFuerte: [],
          gaps: [],
          bloqueadoresDuros: [],
          senalesPositivas: [],
          veredicto: "Evaluación de prueba (e2e 68).",
          accion: "aplicar",
        });

      const a1 = await seed("remoteok", 1);
      const a2 = await seed("remoteok", 2);
      await evaluate(a1, 8);
      await evaluate(a2, 8);
      const a3 = await seed("remoteok", 3, "aplicada");
      await db.insert(s.applications).values({ jobId: a3, userId: E2E_B_USER_ID });
      await seed("remoteok", 4, "entrevista");
      await seed("remoteok", 5);
      await seed("remoteok", 6);
      await seed("email_linkedin", 1);
      await seed("email_linkedin", 2);
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    await removeSecondUser();
  });

  test("muestra los números de la fuente con datos y «pocos datos» en la otra", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/settings/asistente");
    await closePrivacyDialog(page);

    const stats = page.getByTestId("portal-stats");
    await expect(stats).toBeVisible();
    await expect(
      stats.getByRole("heading", { name: "Qué portal te sirve (últimos 30 días)" }),
    ).toBeVisible();

    const remote = stats.locator('[data-testid="portal-stats-row"][data-group="Remote OK"]');
    await expect(remote.getByTestId("portal-stats-total")).toHaveText("6");
    await expect(remote.getByTestId("portal-stats-high")).toContainText("2 (33 %)");
    await expect(remote.getByTestId("portal-stats-applied")).toContainText("1 (17 %)");
    await expect(remote.getByTestId("portal-stats-interview")).toContainText("1 (17 %)");

    const linkedin = stats.locator('[data-testid="portal-stats-row"][data-group="LinkedIn"]');
    await expect(linkedin.getByTestId("portal-stats-total")).toHaveText("2");
    await expect(linkedin.getByTestId("portal-stats-few")).toHaveText("pocos datos");
    await expect(linkedin.getByTestId("portal-stats-high")).toHaveCount(0);
  });
});
