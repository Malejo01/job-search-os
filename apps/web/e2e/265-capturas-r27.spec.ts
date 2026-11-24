import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { settleBrandMotion } from "./axe-helpers";
import { loginAsSecondUser, removeSecondUser } from "./helpers";
import { cleanB, prepareB } from "./voz-helpers";

/**
 * Flujo 265 (R27-07): capturas de la R27 (Afi), a 390 y 1280 px, en claro y en oscuro, en `ops/capturas/r27/`
 * (la carpeta no se versiona). Persona B (ficticia, tester: ve el asistente). Solo con `CAPTURAS=1` o si existe
 * `ops/capturas/r27/.generar`; sin esa señal se saltea.
 *
 * Pantallas: portada, Hoy (con el saludo si todavía no saludó), el asistente abierto, un vacío (CV sin
 * armar), Interview, Academy y el 404. El festejo no se fuerza acá: sale al marcar una postulación como
 * enviada o al terminar el CV con el coach, que piden datos y pasos que cubren los e2e de momentos
 * (256–262); si hace falta la captura, se saca a mano en esos flujos.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r27");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;

test.describe.configure({ mode: "serial" });
test.skip(!SHOTS, "sin CAPTURAS=1 ni ops/capturas/r27/.generar");
test.setTimeout(120_000);

test.afterAll(async () => {
  await cleanB().catch(() => {});
  await removeSecondUser().catch(() => {});
});

async function shot(page: Page, name: string, width: number, theme: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await settleBrandMotion(page);
  // Las herramientas de desarrollo de Next no son parte de la app
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: false });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`portada y 404 sin sesión a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      await page.goto("/");
      await expect(page.locator('[data-afi="saludando"]')).toBeVisible();
      await shot(page, "01-portada", width, theme);
      await page.goto("/ruta-que-no-existe-r27");
      await expect(page.locator("[data-afi]").first()).toBeVisible();
      await shot(page, "07-404", width, theme);
    });

    test(`Hoy, asistente, vacío, Interview y Academy a ${width} px en ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      const sessionId = await prepareB("Simulación ficticia de las capturas");
      await loginAsSecondUser(page);

      await page.goto("/hoy");
      await expect(page.getByTestId("asistente-mascota")).toBeVisible();
      await shot(page, "02-hoy-saludo", width, theme);

      // El asistente abierto
      await page.getByTestId("asistente-mascota").click();
      await expect(page.getByTestId("assistant-panel")).toBeVisible();
      await shot(page, "03-asistente-abierto", width, theme);
      await page.keyboard.press("Escape");

      // Un vacío: la persona B no tiene CV armado
      await page.goto("/cv");
      await shot(page, "04-vacio-cv", width, theme);

      await page.goto(`/interview/${sessionId}`);
      await expect(page.getByTestId("interview-progress-label")).toBeVisible();
      await shot(page, "05-interview-pregunta", width, theme);

      await page.goto("/academy");
      await expect(page.locator("h1").first()).toBeVisible();
      await shot(page, "06-academy", width, theme);
    });
  }
}
