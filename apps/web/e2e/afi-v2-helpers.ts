import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { settleBrandMotion } from "./axe-helpers";

/**
 * Ayudas de los e2e de Afi v2 (R29-08): carpeta de capturas, señal para generarlas y la toma de pantalla.
 * Las capturas viven en `ops/capturas/r29/` (la carpeta no se versiona). Las ayudas del asistente de la R27
 * (`AFI_BOTON`, `afiSetup`, …) siguen en `afi-helpers.ts`.
 */
export const CAPTURAS_R29 = join(__dirname, "..", "..", "..", "ops", "capturas", "r29");
export const AFI_V2_DIR = join(CAPTURAS_R29, "afi-v2", "después");

/** Solo con `CAPTURAS=1` o si existe `ops/capturas/r29/afi-v2/después/.generar`. */
export const AFI_SHOTS = process.env.CAPTURAS === "1" || existsSync(join(AFI_V2_DIR, ".generar"));

export const AFI_THEMES = ["claro", "oscuro"] as const;
export const AFI_WIDTHS = [390, 1280] as const;
export type AfiTheme = (typeof AFI_THEMES)[number];

/** Deja el tema elegido antes de que cargue la página (la app lee `jso-tema`). */
export async function setTheme(page: Page, theme: AfiTheme): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
}

/** Captura de la ventana (no de toda la página) con las herramientas de desarrollo de Next ocultas. */
export async function afiShot(
  page: Page,
  dir: string,
  name: string,
  width: number,
  theme: string,
  opts: { fullPage?: boolean } = {},
): Promise<void> {
  await page.waitForLoadState("networkidle");
  await settleBrandMotion(page);
  // Las imágenes de Afi son `lazy`: se fuerzan y se espera a que carguen, o la captura sale con el círculo vacío
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("[data-afi] img"));
    for (const img of imgs) img.loading = "eager";
    await Promise.all(
      imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))),
    );
  });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: join(dir, `${name}-${width}-${theme}.png`),
    fullPage: opts.fullPage ?? false,
  });
}

/**
 * Para cada imagen de Afi visible en la página: que no salga de la ventana en horizontal, que haya cargado y que no
 * sea mucho más ancha que su círculo. Devuelve los problemas en texto (vacío si todo está bien).
 */
export async function afiProblemas(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-afi]"))) {
      const img = el.querySelector("img");
      if (!img) continue;
      const r = img.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // oculta (por ejemplo, la otra variante de Hoy)
      const pose = el.getAttribute("data-afi");
      if (r.left < -0.5 || r.right > vw + 0.5) {
        out.push(`${pose}: sale de la ventana en horizontal`);
      }
      if (!img.complete || img.naturalWidth === 0) out.push(`${pose}: la imagen no cargó`);
      const c = el.getBoundingClientRect();
      if (pose !== "cara" && r.width > c.width * 1.35) {
        out.push(`${pose}: más ancha que su círculo`);
      }
    }
    return out;
  });
}
