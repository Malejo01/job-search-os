import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 293 (R28-15): capturas de «Afi que habla» a 390 y 1280 px, en claro y en oscuro, de Hoy, Match, Interview,
 * Armá tu CV y el coach de CV, en `ops/capturas/r28/afi-dice/` (la carpeta no se versiona). Persona B (ficticia).
 * Solo con `CAPTURAS=1` o si existe `ops/capturas/r28/afi-dice/.generar`; sin esa señal se saltea. Las pantallas
 * apagadas en el entorno (404) se saltean sin fallar.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r28", "afi-dice");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;
const PANTALLAS = [
  { nombre: "hoy", ruta: "/hoy" },
  { nombre: "match", ruta: "/jobs" },
  { nombre: "interview", ruta: "/interview" },
  { nombre: "cv-armar", ruta: "/cv/armar" },
  { nombre: "cv-coach", ruta: "/cv/coach" },
] as const;

test.describe.configure({ mode: "serial" });
test.skip(!SHOTS, "sin CAPTURAS=1 ni ops/capturas/r28/afi-dice/.generar");
test.use({ reducedMotion: "reduce" });
test.setTimeout(120_000);

test.afterAll(async () => {
  await removeSecondUser().catch(() => {});
});

async function shot(page: Page, name: string, width: number, theme: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  // Las herramientas de desarrollo de Next no son parte de la app
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: false });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    for (const { nombre, ruta } of PANTALLAS) {
      test(`${nombre} a ${width} px en ${theme}`, async ({ page }) => {
        await ensureSecondUser();
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
        await loginAsSecondUser(page);
        const res = await page.goto(ruta);
        test.skip(res?.status() === 404, `${ruta} no está disponible en este entorno`);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await shot(page, nombre, width, theme);
      });
    }
  }
}
