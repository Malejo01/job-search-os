import { expect, test, type Page } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  deleteJob,
  ensureSecondUser,
  jobStatus,
  loginAsSecondUser,
  ownerDb,
} from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

type Seed = {
  title: string;
  status: "evaluada" | "aplicada" | "entrevista" | "cerrada";
  /** Días desde la postulación; sin valor = sin postulación. */
  appliedDaysAgo?: number;
  outcome?: "sin_respuesta" | "entrevista" | "cerrada_antes";
  outcomeDaysAgo?: number;
  /** `jobs.updated_at`: los helpers no lo fijan, acá sí. */
  updatedDaysAgo: number;
  withEvaluation?: boolean;
};

/** Oferta ficticia de la persona B con su postulación (si corresponde) y `updated_at` manipulado. */
async function seed(o: Seed): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: E2E_B_USER_ID,
        companyRaw: "Empresa B Agrupadas",
        title: o.title,
        titleNormalized: o.title.toLowerCase(),
        canonicalUrl: `https://example.com/e2e-b/${o.title.replace(/\s+/g, "-")}`,
        locationRaw: "Remoto (Argentina)",
        modality: "remoto",
        status: o.status,
        jdText: "JD ficticia de prueba.",
        flags: [],
        firstSeenAt: daysAgo(o.updatedDaysAgo),
        updatedAt: daysAgo(o.updatedDaysAgo),
      })
      .returning({ id: s.jobs.id });
    const jobId = job!.id;
    if (o.withEvaluation) {
      await db.insert(s.evaluations).values({
        jobId,
        userId: E2E_B_USER_ID,
        criteriaVersion: 1,
        promptVersion: "evaluate_job@e2e",
        model: "fake",
        hadFullJd: true,
        score: 7,
        locationOk: "ok",
        modality: "remoto",
        discipline: "ai_engineer",
        matchFuerte: [],
        gaps: [],
        bloqueadoresDuros: [],
        senalesPositivas: [],
        veredicto: "Evaluación ficticia.",
        accion: "aplicar",
      });
    }
    if (o.appliedDaysAgo !== undefined) {
      await db.insert(s.applications).values({
        jobId,
        userId: E2E_B_USER_ID,
        appliedAt: daysAgo(o.appliedDaysAgo),
        outcome: o.outcome ?? "sin_respuesta",
        outcomeAt: o.outcomeDaysAgo === undefined ? null : daysAgo(o.outcomeDaysAgo),
      });
    }
    return jobId;
  } finally {
    await close();
  }
}

/** Abre un grupo plegado por su testid (si ya está abierto, no hace nada). */
async function openGroup(page: Page, testId: string): Promise<void> {
  const toggle = page.getByTestId(testId).getByRole("button", { expanded: false }).first();
  if (await toggle.count()) await toggle.click();
}

test.describe.configure({ mode: "serial" });

test.describe("Flujo 122: postulaciones agrupadas e inactividad (R4-07)", () => {
  const tag = Date.now();
  const t = (name: string) => `E2E agrupadas ${name} ${tag}`;
  const ids: string[] = [];

  test.beforeAll(async () => {
    await ensureSecondUser();
    ids.push(
      await seed({
        title: t("reciente"),
        status: "aplicada",
        appliedDaysAgo: 3,
        updatedDaysAgo: 3,
      }),
      await seed({
        title: t("entrevista"),
        status: "entrevista",
        appliedDaysAgo: 40,
        outcome: "entrevista",
        outcomeDaysAgo: 2,
        updatedDaysAgo: 2,
      }),
      await seed({
        title: t("inactiva reactivar"),
        status: "aplicada",
        appliedDaysAgo: 40,
        updatedDaysAgo: 40,
      }),
      await seed({
        title: t("inactiva cerrar"),
        status: "aplicada",
        appliedDaysAgo: 45,
        updatedDaysAgo: 45,
      }),
      await seed({
        title: t("evaluada vieja"),
        status: "evaluada",
        updatedDaysAgo: 40,
      }),
      await seed({
        title: t("cerrada"),
        status: "cerrada",
        appliedDaysAgo: 50,
        outcome: "cerrada_antes",
        updatedDaysAgo: 10,
        withEvaluation: true,
      }),
    );
  });
  test.afterAll(async () => {
    for (const id of ids) await deleteJob(id);
  });

  test("cada postulación va a un solo grupo y la inactiva sale de seguimiento", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/applications");

    // Abiertos: la reciente espera respuesta y la entrevista está activa
    await expect(
      page.getByRole("region", { name: /^Esperando respuesta/ }).getByText(t("reciente")),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /^Activas/ }).getByText(t("entrevista")),
    ).toBeVisible();

    // La de 40 días no está en seguimiento y aparece una sola vez, en el grupo plegado
    await expect(
      page.getByTestId("seguimiento-item").filter({ hasText: t("inactiva reactivar") }),
    ).toHaveCount(0);
    await expect(page.getByText(t("inactiva reactivar"))).toHaveCount(0);
    await openGroup(page, "grupo-inactivas");
    await expect(page.getByText(t("inactiva reactivar"))).toHaveCount(1);
    await expect(
      page.getByTestId("grupo-inactivas").getByText(t("inactiva reactivar")),
    ).toBeVisible();
  });

  test("«Reactivar» saca la postulación del grupo de inactivas", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/applications");
    await openGroup(page, "grupo-inactivas");
    const row = page
      .getByTestId("grupo-inactivas")
      .locator("li")
      .filter({ hasText: t("inactiva reactivar") });
    await row.getByRole("button", { name: "Reactivar" }).click();
    await expect(
      page.getByRole("region", { name: /^Esperando respuesta/ }).getByText(t("inactiva reactivar")),
    ).toBeVisible();
  });

  test("«Cerrar por inactividad» deja la oferta cerrada y la muestra en «Cerradas»", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/applications");
    await openGroup(page, "grupo-inactivas");
    const row = page
      .getByTestId("grupo-inactivas")
      .locator("li")
      .filter({ hasText: t("inactiva cerrar") });
    await row.getByText("Cerrar por inactividad").click();
    await row.getByRole("button", { name: "Sí, cerrar" }).click();
    await expect.poll(() => jobStatus(ids[3]!)).toBe("cerrada");
    await openGroup(page, "grupo-cerradas");
    await expect(page.getByTestId("grupo-cerradas").getByText(t("inactiva cerrar"))).toBeVisible();
  });

  test("«Descartar» saca la evaluada vieja de la pantalla y la descarta", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/applications");
    await openGroup(page, "grupo-descartadas");
    const row = page
      .getByTestId("grupo-descartadas")
      .locator("li")
      .filter({ hasText: t("evaluada vieja") });
    await row.getByText("Descartar", { exact: true }).click();
    await row.getByRole("button", { name: "Sí, descartar" }).click();
    await expect.poll(() => jobStatus(ids[4]!)).toBe("descartada");
    // changeStatusAction no revalida /applications por nombre: la pantalla igual tiene que sacarla
    await expect(row).toHaveCount(0);
  });

  test("«Reactivar» una cerrada la devuelve a aplicada", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/applications");
    await openGroup(page, "grupo-cerradas");
    const row = page
      .getByTestId("grupo-cerradas")
      .locator("li")
      .filter({ hasText: t("cerrada") });
    await row.getByRole("button", { name: "Reactivar" }).click();
    await expect.poll(() => jobStatus(ids[5]!)).toBe("aplicada");
  });
});
