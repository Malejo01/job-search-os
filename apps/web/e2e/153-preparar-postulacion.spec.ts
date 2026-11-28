import { expect, test } from "@playwright/test";
import { createJob, deleteJob, jobStatus, login } from "./helpers";

/**
 * Preparar mi postulación (R17-06): desde la oferta se llega a una página que junta lo preparado y
 * termina en un enlace al aviso. No postula, no cambia el estado de la oferta y solo ofrece enlaces
 * https con rel seguro (ADR-004).
 */
const AVISO_URL = "https://example.com/e2e/preparar-postulacion";

let conUrl: string;
let sinUrl: string;

test.describe("Preparar mi postulación", () => {
  test.beforeAll(async () => {
    conUrl = await createJob({
      title: `E2E preparar ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de prueba para preparar la postulación.",
      canonicalUrl: AVISO_URL,
    });
    sinUrl = await createJob({
      title: `E2E preparar sin link ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de un aviso sin link.",
      canonicalUrl: null,
    });
  });
  test.afterAll(async () => {
    for (const id of [conUrl, sinUrl]) if (id) await deleteJob(id);
  });

  test("el botón de la oferta lleva a la página, con checklist y «Ir al aviso» seguro", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${conUrl}`);
    // R30-10: «Preparar mi postulación» es una sección plegable del detalle; el CV va por su enlace
    await page.getByTestId("seccion-preparar").locator("summary").click();
    await page.getByRole("link", { name: "Revisar mi CV para esta oferta" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${conUrl}/postular$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Preparar mi postulación" }),
    ).toBeVisible();
    await expect(page.getByTestId("postular-respuestas")).toBeVisible();
    await expect(page.getByTestId("postular-cv")).toBeVisible();
    await expect(page.getByTestId("postular-checklist").getByRole("listitem")).toHaveCount(5);

    const ir = page.getByRole("link", { name: /Ir al aviso/ });
    await expect(ir).toHaveAttribute("href", AVISO_URL);
    await expect(ir).toHaveAttribute("target", "_blank");
    await expect(ir).toHaveAttribute("rel", /noopener/);
    await expect(ir).toHaveAttribute("rel", /noreferrer/);
  });

  test("entrar a la página no cambia el estado de la oferta", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${conUrl}/postular`);
    await expect(page.getByTestId("ir-al-aviso")).toBeVisible();
    expect(await jobStatus(conUrl)).toBe("evaluada");
  });

  test("un aviso sin link no ofrece «Ir al aviso»", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${sinUrl}/postular`);
    await expect(page.getByRole("link", { name: /Ir al aviso/ })).toHaveCount(0);
    await expect(page.getByTestId("sin-enlace")).toBeVisible();
  });

  test("un id que no es de una oferta da 404", async ({ page }) => {
    await login(page);
    const res = await page.goto("/jobs/00000000-0000-4000-8000-000000000000/postular");
    expect(res?.status()).toBe(404);
  });
});
