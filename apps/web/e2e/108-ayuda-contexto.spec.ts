import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { E2E_USER_ID, createEvaluation, createJob, deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 108 (C8-6): «¿Qué es esto?» en las 5 pantallas donde una persona no técnica más se traba
 * (puntaje, «A tu favor / Te falta», Sin descripción, CV y áreas). Se abre con teclado, explica en
 * llano y no suma violaciones de axe, en claro y oscuro, a 390 px.
 */
test.describe("Flujo 108: ayuda en contexto (C8-6)", () => {
  const tag = Date.now();
  let evaluatedId = "";
  let pendingId = "";

  test.beforeAll(async () => {
    evaluatedId = await createJob({ title: `Analista contable ayuda ${tag}`, status: "evaluada" });
    await createEvaluation(evaluatedId, {
      score: 7.5,
      accion: "aplicar",
      riesgos: ["Sueldo no publicado"],
    });
    pendingId = await createJob({
      title: `Asistente contable ayuda ${tag}`,
      status: "pendiente_jd",
      jdText: null,
    });
  });

  test.afterAll(async () => {
    await deleteJob(evaluatedId).catch(() => {});
    await deleteJob(pendingId).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  async function openTip(page: Page, topic: string, text: RegExp) {
    const tip = page.getByTestId(`ayuda-${topic}`);
    await expect(tip).toBeVisible();
    const summary = tip.locator("summary");
    await expect(summary).toContainText("¿Qué es esto?");
    // Con teclado, como lo usaría alguien sin mouse
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(tip).toHaveAttribute("open", "");
    await expect(tip).toContainText(text);
    const box = await summary.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  const PAGES: Array<{ name: string; path: () => string; topics: Array<[string, RegExp]> }> = [
    {
      name: "detalle de una oferta",
      path: () => `/jobs/${evaluatedId}`,
      topics: [
        ["puntaje", /del 1 al 10/],
        ["aFavorTeFalta", /lo que el aviso pide y vos ya tenés/],
      ],
    },
    {
      name: "Sin descripción",
      path: () => "/jobs/pending-jd",
      topics: [["sinDescripcion", /copiá todo el texto/]],
    },
    { name: "Tu CV", path: () => "/cv", topics: [["cv", /No inventamos nada/]] },
  ];

  for (const p of PAGES) {
    test(`${p.name}: se abre y explica en llano`, async ({ page }) => {
      await page.goto(p.path());
      for (const [topic, text] of p.topics) await openTip(page, topic, text);
    });

    for (const tema of ["claro", "oscuro"] as const) {
      test(`${p.name}: abierta, sin violaciones de axe (${tema})`, async ({ page }) => {
        await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
        await page.goto(p.path());
        for (const [topic] of p.topics) {
          await page.getByTestId(`ayuda-${topic}`).locator("summary").click();
        }
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations).toEqual([]);
        expect(unmeasured).toEqual([]);
      });
    }
  }

  test("áreas: aparece en «Tus puestos» con una carrera que tiene áreas", async ({ page }) => {
    // El seed no tiene carreras: se le pone contaduría un momento y se restaura lo que tenía
    const { db, close } = ownerDb();
    try {
      const [before] = await db
        .select({ roles: s.profiles.targetRoles, role: s.profiles.targetRole })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      await db
        .update(s.profiles)
        .set({ targetRoles: ["finanzas_contabilidad"], targetRole: "finanzas_contabilidad" })
        .where(eq(s.profiles.userId, E2E_USER_ID));
      try {
        await page.goto("/settings");
        await openTip(page, "areas", /impuestos no es lo mismo que auditoría/);
      } finally {
        await db
          .update(s.profiles)
          .set({ targetRoles: before!.roles, targetRole: before!.role })
          .where(eq(s.profiles.userId, E2E_USER_ID));
      }
    } finally {
      await close();
    }
  });
});
