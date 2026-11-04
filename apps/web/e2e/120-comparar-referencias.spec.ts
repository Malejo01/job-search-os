import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { settleBrandMotion } from "./axe-helpers";
import { loginAsLucia, seedLucia } from "./c10/lucia";

/**
 * Flujo 120 (C10-1): captura contra referencia. Por cada pantalla aprobada el 4/11
 * (`docs/ux/rediseno-afiniajobs/referencias/`), abre la página real con los datos de Lucía, saca
 * una captura del mismo tamaño que la referencia (390 × 844 o 1280 × 900, a 2x, en claro) y arma
 * una imagen «referencia | real» en `e2e/__comparaciones__/<pantalla>-<ancho>.png`. No compara
 * píxeles ni falla por diferencias: la comparación la mira una persona (o el agente) antes de
 * mergear. El CI la sube como artefacto «comparaciones»; nunca va al repo.
 */
const REF_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "ux",
  "rediseno-afiniajobs",
  "referencias",
);
const OUT = join(__dirname, "__comparaciones__");

type Ids = Awaited<ReturnType<typeof seedLucia>>;
type Screen = {
  name: string;
  width: 390 | 1280;
  ref: string;
  session: boolean;
  path: (ids: Ids) => string;
};

const SCREENS: readonly Screen[] = [
  { name: "portada", width: 1280, ref: "portada-pc.png", session: false, path: () => "/" },
  { name: "portada", width: 390, ref: "portada-cel.png", session: false, path: () => "/" },
  { name: "acceso", width: 1280, ref: "acceso-pc.png", session: false, path: () => "/acceso" },
  { name: "acceso", width: 390, ref: "acceso-cel.png", session: false, path: () => "/acceso" },
  { name: "hoy", width: 1280, ref: "hoy-pc.png", session: true, path: () => "/hoy" },
  { name: "hoy", width: 390, ref: "hoy-cel.png", session: true, path: () => "/hoy" },
  {
    name: "ofertas",
    width: 1280,
    ref: "ofertas-pc.png",
    session: true,
    path: (ids) => `/jobs?oferta=${ids.analista}`,
  },
  { name: "ofertas", width: 390, ref: "ofertas-cel.png", session: true, path: () => "/jobs" },
  {
    name: "detalle",
    width: 390,
    ref: "detalle-cel.png",
    session: true,
    path: (ids) => `/jobs/${ids.analista}`,
  },
];

const HEIGHT = { 390: 844, 1280: 900 } as const;

test.use({ deviceScaleFactor: 2, colorScheme: "light" });

/** Une la referencia y la captura real, a la misma escala, con un rótulo arriba de cada una. */
async function sideBySide(browser: Browser, screen: Screen, real: Buffer): Promise<void> {
  const ref = readFileSync(join(REF_DIR, screen.ref)).toString("base64");
  const w = screen.width;
  const h = HEIGHT[screen.width];
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  try {
    await page.setViewportSize({ width: w * 2 + 72, height: h + 80 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#FFFFFF;font:700 16px system-ui,sans-serif;color:#14123A">
      <div style="display:flex;gap:24px;padding:16px 24px 24px">
        <figure style="margin:0"><figcaption style="padding-bottom:8px">Referencia · ${screen.ref}</figcaption>
          <img src="data:image/png;base64,${ref}" style="display:block;width:${w}px;height:${h}px;object-fit:cover;object-position:top;outline:1px solid #D4D4DC"></figure>
        <figure style="margin:0"><figcaption style="padding-bottom:8px">Real · ${screen.name} · ${w} px</figcaption>
          <img src="data:image/png;base64,${real.toString("base64")}" style="display:block;width:${w}px;height:${h}px;outline:1px solid #D4D4DC"></figure>
      </div></body></html>`);
    await page.waitForFunction(() =>
      Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
    );
    await page.screenshot({
      path: join(OUT, `${screen.name}-${screen.width}.png`),
      fullPage: true,
    });
  } finally {
    await page.close();
  }
}

async function capture(page: Page, screen: Screen, ids: Ids): Promise<Buffer> {
  await page.setViewportSize({ width: screen.width, height: HEIGHT[screen.width] });
  await page.goto(screen.path(ids));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeAttached();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await settleBrandMotion(page);
  // El indicador de `next dev` (corridas locales) no es parte de la pantalla
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const real = await page.screenshot();
  writeFileSync(join(OUT, `${screen.name}-${screen.width}-real.png`), real);
  return real;
}

test.describe("Flujo 120: captura contra referencia (C10)", () => {
  let ids: Ids;

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    ids = await seedLucia();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("jso-tema", "claro"));
  });

  test("pantallas sin sesión", async ({ page, browser }) => {
    for (const screen of SCREENS.filter((s) => !s.session)) {
      await sideBySide(browser, screen, await capture(page, screen, ids));
    }
  });

  test("pantallas con sesión (Lucía)", async ({ page, browser }) => {
    await loginAsLucia(page);
    for (const screen of SCREENS.filter((s) => s.session)) {
      await sideBySide(browser, screen, await capture(page, screen, ids));
    }
  });
});
