import { expect, test } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { E2E_USER_ID, createJob, deleteJob, jobStatus, login, ownerDb } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

/** Job del usuario seed con su postulación; `entrevista` se deja como lo deja el evento `interview`. */
async function createApplied(
  title: string,
  options: { status: "aplicada" | "entrevista"; appliedDaysAgo: number; outcomeDaysAgo?: number },
): Promise<string> {
  const jobId = await createJob({ title, status: "aplicada", jdText: "JD de prueba." });
  const { db, close } = ownerDb();
  try {
    if (options.status === "entrevista") {
      await db.update(s.jobs).set({ status: "entrevista" }).where(eq(s.jobs.id, jobId));
    }
    await db.insert(s.applications).values({
      jobId,
      userId: E2E_USER_ID,
      appliedAt: daysAgo(options.appliedDaysAgo),
      outcome: options.status === "entrevista" ? "entrevista" : "sin_respuesta",
      outcomeAt: options.outcomeDaysAgo === undefined ? null : daysAgo(options.outcomeDaysAgo),
    });
  } finally {
    await close();
  }
  return jobId;
}

async function followUpAtOf(jobId: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ at: s.applications.followUpAt })
      .from(s.applications)
      .where(eq(s.applications.jobId, jobId));
    return row?.at ?? null;
  } finally {
    await close();
  }
}

test.describe("Flujo 67: para hacer seguimiento (ronda 113)", () => {
  const stamp = Date.now();
  const titleA = `E2E seguimiento aplicada ${stamp}`;
  const titleB = `E2E seguimiento entrevista ${stamp}`;
  let jobA: string;
  let jobB: string;

  test.beforeAll(async () => {
    jobA = await createApplied(titleA, { status: "aplicada", appliedDaysAgo: 10 });
    jobB = await createApplied(titleB, {
      status: "entrevista",
      appliedDaysAgo: 30,
      outcomeDaysAgo: 6,
    });
  });
  test.afterAll(async () => {
    await deleteJob(jobA);
    await deleteJob(jobB);
  });

  test("aparece en la sección y el contador; postergar y cerrar la sacan", async ({ page }) => {
    await login(page);
    await page.goto("/applications");
    const section = page.getByRole("region", { name: "Para hacer seguimiento" });
    await expect(section).toBeVisible();
    const itemA = section.getByTestId("seguimiento-item").filter({ hasText: titleA });
    const itemB = section.getByTestId("seguimiento-item").filter({ hasText: titleB });
    await expect(itemA).toBeVisible();
    await expect(itemA).toContainText("hace 10 días");
    await expect(itemB).toBeVisible();
    await expect(itemB).toContainText("hace 6 días");

    // El contador del menú tiene al menos estas dos
    const count = page.getByTestId("nav-count").first();
    await expect(count).toBeAttached();
    expect(Number.parseInt((await count.textContent()) ?? "0", 10)).toBeGreaterThanOrEqual(2);

    // «Me respondieron» lleva al detalle
    await expect(itemA.getByRole("link", { name: "Me respondieron" })).toHaveAttribute(
      "href",
      `/jobs/${jobA}`,
    );

    // «Ya hice seguimiento» lo saca y deja la postergación en la base
    await itemA.getByRole("button", { name: "Ya hice seguimiento" }).click();
    await expect(itemA).toHaveCount(0);
    await expect(itemB).toBeVisible();
    expect(await followUpAtOf(jobA)).not.toBeNull();

    // «Cerrar postulación» pide confirmación y después cierra la oferta
    await itemB.getByText("Cerrar postulación").click();
    await itemB.getByRole("button", { name: "Sí, cerrar" }).click();
    await expect(itemB).toHaveCount(0);
    await expect.poll(() => jobStatus(jobB)).toBe("cerrada");
  });
});
