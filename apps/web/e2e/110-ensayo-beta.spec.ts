import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { ownerDb } from "./helpers";
import {
  cleanup,
  completeStep1,
  createInvitation,
  fillSkills,
  newRun,
  register,
  seedAndEvaluate,
  seedPool,
} from "./personas/flow";
import type { PersonaKey } from "./personas/personas";

/**
 * Flujo 110 (C8-13): el ensayo del 23 y 24/11 de punta a punta, una persona por cada carrera de la
 * beta (las de C5-4 y G3), en un celular de 390 px: invitación, registro, onboarding, ofertas
 * evaluadas (worker demo, sin LLM), el detalle con su puntaje, Tu CV y «Contanos qué pasó». El detalle
 * se mide con axe en claro y oscuro. Guion humano en docs/beta/ensayo.md.
 */
const PERSONAS: Array<[PersonaKey, string]> = [
  ["mariana", "abogacía"],
  ["agustina", "contaduría"],
  ["bruno", "administración"],
  ["camila", "comunicación"],
  ["rocio", "marketing y RR.PP."],
  ["ines", "relaciones internacionales"],
];

for (const [key, carrera] of PERSONAS) {
  test.describe(`Flujo 110: ensayo de ${carrera} (${key})`, () => {
    test.describe.configure({ mode: "serial" });
    const run = newRun(key);
    const ownTitles = run.persona.offers.filter((o) => o.own).map((o) => o.title);
    let context: BrowserContext | undefined;
    let page: Page;
    let detailUrl = "";

    test.beforeAll(async ({ browser }) => {
      await createInvitation(run);
      await seedPool(run);
      context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await cleanup(run, context);
    });

    test("invitación, registro y onboarding", async () => {
      await register(page, run);
      await completeStep1(page, run);
      await fillSkills(page, run);
    });

    test("ofertas evaluadas y el detalle con su puntaje", async () => {
      await seedAndEvaluate(run);
      await page.goto("/jobs");
      await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
      const link = page.getByRole("link", { name: ownTitles[0]! }).first();
      await expect(link).toBeVisible({ timeout: 15_000 });
      await link.click();
      await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
      detailUrl = page.url();
      await expect(page.getByRole("heading", { level: 1, name: ownTitles[0]! })).toBeVisible();
      await expect(page.getByRole("img", { name: /^puntaje/ }).first()).toBeVisible();
    });

    test("Tu CV se abre", async () => {
      await page.goto("/cv");
      await expect(page.getByRole("heading", { level: 1, name: "Tu CV" })).toBeVisible();
    });

    test("«Contanos qué pasó» llega a la base", async () => {
      const mensaje = `Ensayo ${carrera}: comentario ficticio ${run.tag}`;
      await page.goto("/hoy");
      await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
      const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
      await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
      await dialog.getByLabel("Tu mensaje").fill(mensaje);
      await dialog.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();
      const { db, close } = ownerDb();
      try {
        const rows = await db
          .select({ message: s.betaFeedback.message, path: s.betaFeedback.path })
          .from(s.betaFeedback)
          .where(eq(s.betaFeedback.userId, run.userId!));
        expect(rows).toContainEqual({ message: mensaje, path: "/hoy" });
      } finally {
        await close();
      }
    });

    test("el detalle sin violaciones de axe en claro y oscuro", async () => {
      for (const tema of ["claro", "oscuro"]) {
        await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
        await page.goto(detailUrl);
        await expect(page.getByRole("img", { name: /^puntaje/ }).first()).toBeVisible();
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, tema).toEqual([]);
        expect(unmeasured, tema).toEqual([]);
      }
    });
  });
}
