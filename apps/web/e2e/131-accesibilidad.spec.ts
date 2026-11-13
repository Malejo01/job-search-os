import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settleBrandMotion } from "./axe-helpers";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 131 (R7-5): axe en las pantallas de la beta, en claro y oscuro. A diferencia de los flujos
 * 70 y 88 (que fallan con cualquier violación en un conjunto de rutas), acá el test falla solo con
 * violaciones «serious» o «critical». Las «moderate» y «minor» no cortan: quedan como anotación y
 * adjunto del reporte de Playwright y se vuelcan a docs/beta/accesibilidad-r7.md.
 * El oscuro se activa con `jso-tema` en localStorage, como lo haría una persona.
 */

const TEMAS = ["claro", "oscuro"] as const;
type Tema = (typeof TEMAS)[number];

async function usarTema(page: Page, tema: Tema): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
}

async function esperarTema(page: Page, tema: Tema): Promise<void> {
  const dark = page.locator("html");
  if (tema === "oscuro") await expect(dark).toHaveClass(/\bdark\b/);
  else await expect(dark).not.toHaveClass(/\bdark\b/);
}

/** Corre axe (WCAG A y AA); falla con serious/critical y deja el resto como anotación. */
async function revisar(page: Page, etiqueta: string): Promise<void> {
  await settleBrandMotion(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const resumir = (impactos: string[]) =>
    result.violations
      .filter((v) => impactos.includes(v.impact ?? ""))
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  const graves = resumir(["serious", "critical"]);
  const leves = resumir(["moderate", "minor"]);
  if (leves.length > 0) {
    // R8-6: también al log del CI (anotaciones y adjuntos solo salen en el reporte HTML, que el job
    // no sube si el e2e pasa). Son reglas y selectores de la propia app, sin datos de personas.
    console.log(`[a11y-leves] ${etiqueta}: ${leves.join("; ")}`);
    test
      .info()
      .annotations.push({ type: "a11y-leves", description: `${etiqueta}: ${leves.join("; ")}` });
    await test.info().attach(`a11y-leves ${etiqueta}`, {
      body: leves.join("\n"),
      contentType: "text/plain",
    });
  }
  expect(graves, `axe serious/critical en ${etiqueta}`).toEqual([]);
}

test.describe("Flujo 131: accesibilidad sin sesión", () => {
  const PUBLICAS = ["/", "/acceso", "/precios", "/ayuda"] as const;
  for (const tema of TEMAS) {
    for (const path of PUBLICAS) {
      test(`${path} en ${tema}`, async ({ page }) => {
        await usarTema(page, tema);
        const res = await page.goto(path);
        // /precios da 404 mientras PRICING_ENABLED esté apagado: no hay nada que medir
        test.skip(
          path === "/precios" && res?.status() === 404,
          "/precios apagada (PRICING_ENABLED)",
        );
        await esperarTema(page, tema);
        await expect(page.locator("h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await revisar(page, `${path} (${tema})`);
      });
    }
  }
});

test.describe("Flujo 131: accesibilidad con sesión", () => {
  const tag = Date.now();
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createJob({
      title: `Oferta Ficticia Accesibilidad ${tag}`,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo de accesibilidad.",
    });
    await createEvaluation(jobId, { score: 6, accion: "aplicar" });
  });

  test.afterAll(async () => {
    await deleteJob(jobId).catch(() => {});
  });

  const RUTAS: Array<{ label: string; path: () => string }> = [
    { label: "/hoy", path: () => "/hoy" },
    { label: "/jobs", path: () => "/jobs" },
    { label: "/jobs/[id]", path: () => `/jobs/${jobId}` },
    { label: "/jobs/new", path: () => "/jobs/new" },
    { label: "/cv", path: () => "/cv" },
    { label: "/settings/perfil", path: () => "/settings/perfil" },
  ];

  for (const tema of TEMAS) {
    for (const ruta of RUTAS) {
      test(`${ruta.label} en ${tema}`, async ({ page }) => {
        await usarTema(page, tema);
        await login(page);
        await page.goto(ruta.path());
        await esperarTema(page, tema);
        await expect(page.locator("h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await revisar(page, `${ruta.label} (${tema})`);
      });
    }

    test(`panel del asistente abierto en ${tema}`, async ({ page }) => {
      await usarTema(page, tema);
      await login(page);
      await page.goto("/hoy");
      await esperarTema(page, tema);
      const boton = page.getByRole("button", { name: "Abrir asistente", exact: true });
      if ((await boton.count()) === 0) {
        // En el CI el usuario e2e es admin y el flag está encendido: si falta la mascota, es un error
        expect(process.env.CI, "En el CI la mascota del asistente tiene que estar").toBeFalsy();
        test.skip(true, "El asistente no está encendido para el usuario e2e");
      }
      await boton.click();
      await expect(page.getByTestId("assistant-panel")).toBeVisible();
      await revisar(page, `panel del asistente (${tema})`);
    });
  }
});
