import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { axeSummary, settleBrandMotion } from "./axe-helpers";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 116 (C9-17): revisión del rediseño en las pantallas clave, a 390 y 1280 px, en claro y en
 * oscuro. En cada una: axe sin violaciones, sin scroll horizontal y foco visible en el primer
 * elemento que se toca. Con `CAPTURAS=1` guarda una captura de cada una en
 * `test-results/capturas/` (el CI la sube como artefacto; nunca va al repo). Datos inventados.
 */
const OUT = join(__dirname, "..", "test-results", "capturas");
const SHOTS = process.env.CAPTURAS === "1";

const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;

async function check(page: Page, name: string, width: number, theme: string) {
  await page.waitForLoadState("networkidle");
  await settleBrandMotion(page);
  const { violations, unmeasured } = await axeSummary(page, ['[data-logo-fondo="accent"]']);
  expect(violations, `${name} ${width} ${theme}`).toEqual([]);
  expect(unmeasured, `${name} ${width} ${theme}`).toEqual([]);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `scroll horizontal en ${name} ${width} ${theme}`).toBeLessThanOrEqual(
    innerWidth,
  );
  if (SHOTS) {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: true });
  }
}

test.describe("Flujo 116: revisión del rediseño", () => {
  const tag = Date.now();
  let top = "";
  let far = "";

  test.beforeAll(async () => {
    top = await createJob({ title: `Analista contable ficticia ${tag}`, status: "evaluada" });
    await createEvaluation(top, { score: 9.2 });
    far = await createJob({ title: `Puesto lejano ficticio ${tag}`, status: "evaluada" });
    await createEvaluation(far, { score: 1.5 });
  });

  test.afterAll(async () => {
    for (const id of [top, far]) if (id) await deleteJob(id);
  });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`pantallas públicas a ${width} px en ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
        for (const [name, path] of [
          ["portada", "/"],
          ["acceso", "/acceso"],
          ["ayuda", "/ayuda"],
          ["404", "/no-existe-esta-pagina"],
        ] as const) {
          await page.goto(path);
          await check(page, name, width, theme);
        }
      });

      test(`pantallas con sesión a ${width} px en ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
        await login(page);
        const screens: Array<[string, string]> = [
          ["hoy", "/hoy"],
          ["ofertas", "/jobs?estado=todas"],
          ["detalle-muy-afin", `/jobs/${top}`],
          ["detalle-lejana", `/jobs/${far}`],
          ["componentes", "/settings/marca/componentes"],
        ];
        if (width === 1280) screens.push(["ofertas-panel", `/jobs?estado=todas&oferta=${top}`]);
        for (const [name, path] of screens) {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          await check(page, name, width, theme);
        }
        // Las lejanas van al final, bajo su separador
        await page.goto("/jobs?estado=todas");
        await expect(page.getByTestId("lejanas")).toContainText(`Puesto lejano ficticio ${tag}`);
      });
    }
  }

  test("foco visible: botón principal, pestaña y tarjeta", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=todas");
    for (const target of [
      page.getByRole("link", { name: "+ Cargar oferta" }),
      page.getByTestId("tabbar").getByRole("link", { name: "Hoy" }),
      page.getByRole("link", { name: `Abrir el detalle de Analista contable ficticia ${tag}` }),
    ]) {
      await target.focus();
      const outline = await target.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe("none");
    }
  });
});
