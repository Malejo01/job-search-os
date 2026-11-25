import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlanNoticeEmail, buildWelcomeEmail, EMAIL_MASCOTA } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";
import { AFI_SHOTS, AFI_V2_DIR } from "./afi-v2-helpers";

/**
 * Flujo 333 (R29-08): lo que sale de la app con Afi v2: los emails de bienvenida y de vencimiento (114 px de ancho
 * por 160 de alto), la imagen para compartir (OG) en español y en inglés, y el favicon. Reemplaza en esta tanda al
 * 308 de la R28, que comprobaba el ancho de la v1 (94 px).
 *
 * Los emails se abren en Chromium a 390 y 1280 px, en claro y en oscuro (`prefers-color-scheme`): la imagen carga
 * con su tamaño fijo, no hay scroll horizontal y el cuerpo declara el esquema claro. Las capturas y las imágenes OG
 * se guardan en `ops/capturas/r29/afi-v2/después/` solo con la señal de las capturas (`CAPTURAS=1` o `.generar`).
 * Esto NO reemplaza a Gmail, Outlook ni Apple Mail reales: esa revisión es manual. Datos inventados.
 */
const OUT = join(AFI_V2_DIR, "afuera");
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

test("el ancho del email de Afi v2 es de 114 px por 160", () => {
  expect(EMAIL_MASCOTA.width).toBe(114);
  expect(EMAIL_MASCOTA.height).toBe(160);
});

for (const [nombre, html] of Object.entries(EMAILS)) {
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      test(`${nombre} a ${width} px en ${scheme}: Afi v2 carga con su tamaño y sin scroll horizontal`, async ({
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
        await expect(img).toHaveAttribute("src", /\/mascota\/saludando-512\.png$/);
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

        if (AFI_SHOTS) {
          mkdirSync(OUT, { recursive: true });
          await page.screenshot({
            path: join(OUT, `email-${nombre}-${width}-${scheme}.png`),
            fullPage: true,
          });
        }
      });
    }
  }
}

for (const ruta of ["/opengraph-image-es", "/opengraph-image-en"] as const) {
  test(`la imagen para compartir ${ruta} sale como PNG de 1200x630`, async ({ request }) => {
    const res = await request.get(ruta);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
    const bytes = await res.body();
    expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    if (AFI_SHOTS) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${ruta.slice(1)}.png`), bytes);
    }
  });
}

test("el favicon se sirve (PNG de 192 px e ICO); la cara se mira en la captura", async ({
  request,
}) => {
  const [icono, ico] = await Promise.all([request.get("/icon.png"), request.get("/favicon.ico")]);
  expect(icono.status()).toBe(200);
  expect(ico.status()).toBe(200);
  const png = await icono.body();
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(192);
  if (AFI_SHOTS) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "favicon-192.png"), png);
    writeFileSync(join(OUT, "favicon-app.ico"), await ico.body());
  }
});
