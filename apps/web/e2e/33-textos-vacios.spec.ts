import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_USER_ID, createEvaluation, createJob, deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 33 (ronda 44): textos y vacíos. Con el usuario e2e de siempre (sin pasar por el paso 1 del
 * onboarding): «Tus primeras ofertas» sin pool distingue «estamos buscando» (dentro de la ventana)
 * de «por ahora no hay ofertas» (pasada la ventana, con los dos caminos), y `/jobs` muestra el
 * score con escala y la línea de «Estimación previa». Sin red. Todo inventado.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 33: textos y vacíos", () => {
  const tag = Date.now();
  const evaluatedTitle = `Oferta Ficticia Evaluada ${tag}`;
  const pendingTitle = `Oferta Ficticia Sin Evaluar ${tag}`;
  const jobIds: string[] = [];
  let originalUpdatedAt: Date | null = null;

  /** Fija `profiles.updated_at` del usuario e2e (la ventana de «estamos buscando» se mide desde ahí). */
  async function setProfileUpdatedAt(date: Date): Promise<void> {
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ updatedAt: date })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
  }

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ updatedAt: s.profiles.updatedAt })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      originalUpdatedAt = row?.updatedAt ?? null;
    } finally {
      await close();
    }
    const evaluated = await createJob({
      title: evaluatedTitle,
      status: "evaluada",
      jdText: "JD ficticia para el flujo de textos.",
    });
    await createEvaluation(evaluated, { score: 7.5 });
    const pending = await createJob({ title: pendingTitle, status: "pendiente_jd" });
    jobIds.push(evaluated, pending);
  });

  test.afterAll(async () => {
    if (originalUpdatedAt) await setProfileUpdatedAt(originalUpdatedAt);
    for (const id of jobIds) await deleteJob(id);
  });

  test("dentro de la ventana, sin ofertas: «estamos buscando»", async ({ page }) => {
    await setProfileUpdatedAt(new Date());
    await login(page);
    await page.goto("/onboarding/ofertas");
    await expect(page.getByTestId("first-offers-searching")).toContainText(
      "Estamos buscando ofertas",
    );
    await expect(page.getByTestId("first-offers-empty")).toHaveCount(0);
  });

  test("pasada la ventana, sin ofertas: «por ahora no hay» con los dos caminos", async ({
    page,
  }) => {
    await setProfileUpdatedAt(new Date(Date.now() - 60 * 60_000));
    await login(page);
    await page.goto("/onboarding/ofertas");
    const empty = page.getByTestId("first-offers-empty");
    await expect(empty).toContainText("Por ahora no hay ofertas para tus puestos");
    await expect(
      empty.getByRole("link", { name: "Pegá una oferta que te interese" }),
    ).toHaveAttribute("href", "/jobs/new");
    await expect(
      empty.getByRole("link", { name: "Revisá tus puestos en Ajustes" }),
    ).toHaveAttribute("href", "/settings#puesto");
    await expect(empty).toContainText("Seguimos buscando todos los días");
    await expect(page.getByTestId("first-offers-searching")).toHaveCount(0);
  });

  test("/jobs: score con escala y la línea de «Estimación previa»", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=todas");
    const card = page.getByRole("listitem").filter({ hasText: evaluatedTitle });
    await expect(card).toContainText("7,5");
    await expect(card).toContainText("/10");
    await expect(page.getByTestId("pre-score-explain")).toContainText("Estimación previa");
    await expect(page.getByText(/pre-score/i)).toHaveCount(0);
  });
});
