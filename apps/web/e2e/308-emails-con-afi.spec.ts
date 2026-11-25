import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildPlanNoticeEmail, buildWelcomeEmail, EMAIL_MASCOTA } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";

/**
 * Flujo 308 (R28-11): los emails de bienvenida y de vencimiento con Afi, abiertos en Chromium a 390 y 1280 px en claro
 * y en oscuro (`prefers-color-scheme`). Comprueba que la imagen carga con su tamaño fijo, que no hay scroll horizontal
 * y que el email declara el esquema claro; con `CAPTURAS=1` o `ops/capturas/r28/emails/.generar` guarda las capturas
 * en `ops/capturas/r28/emails/` (la carpeta no se versiona). Datos inventados.
 *
 * Esto NO reemplaza a Gmail, Outlook ni Apple Mail reales: cada uno recorta o invierte colores a su manera. Esa
 * revisión es manual (ver el informe de R28-11).
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r28", "emails");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));
const APP = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const WIDTHS = [390, 1280] as const;
const SCHEMES = ["light", "dark"] as const;

const EMAILS = {
  bienvenida: () =>
    buildWelcomeEmail({
      displayName: "Persona Ficticia",
      until: new Date("2026-12-31T15:00:00Z"),
      becado: false,
      appUrl: APP,
      contactEmail: "hola@example.com",
      cvEnabled: true,
    }).html,
  vencimiento: () =>
    buildPlanNoticeEmail({
      displayName: "Persona Ficticia",
      until: new Date("2026-12-10T12:00:00Z"),
      paymentUrl: "https://pago.example/abc",
      settingsUrl: `${APP}/settings#tu-plan`,
      contactEmail: "hola@example.com",
      becado: false,
    }).html,
} as const;

for (const [nombre, html] of Object.entries(EMAILS)) {
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      test(`${nombre} a ${width} px en ${scheme}: Afi carga con su tamaño y sin scroll horizontal`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        // El HTML se abre con el origen de la app para que la imagen (URL absoluta) cargue de `public/`
        await page.goto(`${APP}/login`);
        await page.setContent(html(), { waitUntil: "load" });

        const img = page.locator("img").first();
        await expect(img).toBeVisible();
        await expect(img).toHaveAttribute("alt", /Afi/);
        const natural = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
        expect(natural, "la imagen no cargó").toBeGreaterThan(0);
        const box = await img.boundingBox();
        expect(Math.round(box!.height)).toBe(EMAIL_MASCOTA.height);
        expect(Math.round(box!.width)).toBe(EMAIL_MASCOTA.width);

        const { sw, w } = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          w: window.innerWidth,
        }));
        expect(sw).toBeLessThanOrEqual(w);

        // Declara el esquema claro: el color del fondo del cuerpo no depende del tema del sistema
        const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(fondo).toBe("rgb(238, 237, 249)");

        if (SHOTS) {
          mkdirSync(OUT, { recursive: true });
          await page.screenshot({
            path: join(OUT, `${nombre}-${width}-${scheme}.png`),
            fullPage: true,
          });
        }
      });
    }
  }
}
