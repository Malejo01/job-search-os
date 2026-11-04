import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import {
  assignPool,
  cleanup,
  completeStep1,
  createInvitation,
  fillSkills,
  newRun,
  register,
  seedPool,
} from "./personas/flow";
import type { PersonaKey } from "./personas/personas";

/**
 * Flujo 107 (C8-5): «Empezá acá» en /hoy para una persona nueva de una carrera no tech, a 390 px.
 * Mariana (abogacía) y Agustina (contaduría): al terminar el onboarding, el perfil ya está; las áreas,
 * las ofertas y el CV quedan pendientes y se marcan solos con lo que se guarda. Desde C10 no tiene
 * «Cerrar» (hoy-pc.png): se va sola cuando no queda nada pendiente.
 * Sin red ni LLM: el pool se siembra como en los e2e de personas.
 */
for (const key of ["mariana", "agustina"] as PersonaKey[]) {
  test.describe(`Flujo 107: «Empezá acá» (${key})`, () => {
    test.describe.configure({ mode: "serial" });
    const run = newRun(key);
    let context: BrowserContext | undefined;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      await createInvitation(run);
      await seedPool(run);
      context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await cleanup(run, context);
    });

    test("recién llegada: áreas, ofertas y CV pendientes (el perfil hecho no se repite)", async () => {
      await register(page, run);
      await completeStep1(page, run);
      await fillSkills(page, run);
      await page.goto("/hoy");
      const card = page.getByTestId("empeza-aca");
      await expect(card.getByRole("heading", { name: "Para hacer hoy" })).toBeVisible();
      // C10-6: lo hecho va tachado; el perfil ya completo no se repite en la lista
      await expect(card).toContainText("0 de 3 listos");
      await expect(page.getByTestId("empeza-aca-perfil")).toHaveCount(0);
      await expect(page.getByTestId("empeza-aca-areas")).toHaveAttribute("data-done", "false");
      await expect(card.getByRole("link", { name: /^Elegir tus áreas/ })).toHaveAttribute(
        "href",
        "/settings#puesto",
      );
      await expect(page.getByTestId("empeza-aca-ofertas")).toHaveAttribute("data-done", "false");
      await expect(card.getByRole("link", { name: /^Subir tu CV/ })).toHaveAttribute(
        "href",
        "/cv/armar",
      );
      // Sin jerga para una persona no tech
      await expect(card).not.toContainText(/skills|pool|score/i);
    });

    test("las ofertas del pool marcan el paso solas", async () => {
      await assignPool(run);
      await page.goto("/hoy");
      // Con ofertas, ese paso ya no se muestra: quedan áreas y CV
      await expect(page.getByTestId("empeza-aca-ofertas")).toHaveCount(0);
      await expect(page.getByTestId("empeza-aca")).toContainText("0 de 2 listos");
    });

    test("sin violaciones de axe en claro y oscuro", async () => {
      for (const tema of ["claro", "oscuro"]) {
        await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
        await page.goto("/hoy");
        await expect(page.getByTestId("empeza-aca")).toBeVisible();
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, tema).toEqual([]);
        expect(unmeasured, tema).toEqual([]);
      }
    });
  });
}
