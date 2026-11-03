import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { like } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 111 (C8-17): triage del feedback en /settings/feedback, solo admin. Filtros, acciones del chip
 * en llano, cambio de estado y CSV sin fórmulas de planilla. Mensajes inventados, borrados al final.
 */
test.describe("Flujo 111: triage del feedback (C8-17)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
  const tag = `triage-${Date.now()}`;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.insert(s.betaFeedback).values([
        {
          userId: E2E_USER_ID,
          category: "algo_no_anduvo",
          message: `${tag} no carga el detalle`,
          path: "/jobs/abc",
          context: {
            pathname: "/jobs/abc",
            actions: [{ type: "click", text: "Ver oferta", time: "2026-11-27T13:59:30Z" }],
          },
        },
        { userId: E2E_USER_ID, category: "idea", message: `=${tag} una idea`, path: "/hoy" },
      ]);
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.betaFeedback).where(like(s.betaFeedback.message, `%${tag}%`));
    } finally {
      await close();
    }
  });

  test("filtra, muestra lo que hizo antes y cambia el estado", async ({ page }) => {
    await login(page);
    await page.goto("/settings/feedback?categoria=algo_no_anduvo&pagina=/jobs");
    const item = page.getByTestId("feedback-item").filter({ hasText: `${tag} no carga` });
    await expect(item).toBeVisible();
    await expect(
      page.getByTestId("feedback-item").filter({ hasText: `${tag} una idea` }),
    ).toHaveCount(0);
    await item.getByText(/Qué hizo antes/).click();
    await expect(item).toContainText("tocó «Ver oferta»");
    await expect(item).toContainText("Nuevo");
    await item.getByRole("button", { name: "Marcar como visto" }).click();
    await expect(
      page.getByTestId("feedback-item").filter({ hasText: `${tag} no carga` }),
    ).toContainText("Visto");
    await page.goto("/settings/feedback?estado=visto");
    await expect(
      page.getByTestId("feedback-item").filter({ hasText: `${tag} no carga` }),
    ).toBeVisible();
  });

  test("el CSV sale sin fórmulas de planilla", async ({ page }) => {
    await login(page);
    const res = await page.request.get("/settings/feedback/export?categoria=idea");
    expect(res.status()).toBe(200);
    const csv = await res.text();
    expect(csv).toContain(`"'=${tag} una idea"`);
    expect(csv).not.toContain(`no carga el detalle`);
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`sin violaciones de axe (${tema})`, async ({ page }) => {
      await login(page);
      await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/settings/feedback");
      await expect(page.getByTestId("feedback-lista")).toBeVisible();
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
    });
  }
});
