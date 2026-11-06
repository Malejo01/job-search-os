import { resolve } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 124 (R4-01): las ilustraciones de la serie E2 (`ilustraciones.md`, junto al manual de marca
 * en docs/ux).
 *
 * Qué prueba:
 * - Los dos archivos de cada escena se sirven sin sesión (el middleware no los manda a /login:
 *   /acceso y el 404 se ven antes de entrar).
 * - /acceso muestra la suya decorativa (`alt=""`), cargada y sin desbordar el celular.
 * - En la vitrina de /settings/marca/componentes (solo admin), las ocho: decoradas, cargadas, con el
 *   recuadro lavanda `#EEEDF9` igual en claro y en oscuro (las de fondo índigo, sin recuadro) y con
 *   el archivo `@2x` solo en pantallas de 2x.
 * - El 404 de una persona con sesión muestra la escena `error`.
 *
 * Las capturas van a ops/tanda-r4/capturas/r4-01/ (no versionado). Sin datos de nadie.
 */

const SCENES = [
  "hoy",
  "acceso",
  "bienvenida",
  "cv",
  "sin-descripcion",
  "vacio",
  "postulaciones",
  "error",
] as const;
const INK_SCENES: readonly string[] = ["hoy", "acceso"];
/** `#EEEDF9` como lo devuelve getComputedStyle. */
const LAVENDER = "rgb(238, 237, 249)";
const CAPTURAS = resolve(__dirname, "../../../ops/tanda-r4/capturas/r4-01");

async function expectLoaded(image: Locator): Promise<void> {
  await expect(image).toHaveAttribute("alt", "");
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

test.describe("Flujo 124: ilustraciones", () => {
  test("los dos archivos de cada escena se sirven sin sesión", async ({ request }) => {
    for (const scene of SCENES) {
      for (const name of [`${scene}.webp`, `${scene}@2x.webp`]) {
        const res = await request.get(`/ilustraciones/${name}`, { maxRedirects: 0 });
        expect(res.status(), name).toBe(200);
        expect(res.headers()["content-type"], name).toContain("image/webp");
      }
    }
  });

  test("la ruta pública /ilustraciones/ no abre otras pantallas sin sesión", async ({
    request,
  }) => {
    // auth.config.ts deja pasar el prefijo /ilustraciones/: subir de carpeta no saltea la sesión
    for (const path of ["/ilustraciones/../hoy", "/ilustraciones/%2e%2e/hoy"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).not.toBe(200);
      expect(res.headers()["location"] ?? "", path).toContain("/login");
    }
  });

  for (const theme of ["claro", "oscuro"] as const) {
    for (const width of [390, 1280]) {
      test(`/acceso en ${theme} a ${width} px: la escena es decorativa, carga y no desborda`, async ({
        page,
      }) => {
        await page.addInitScript((value) => localStorage.setItem("jso-tema", value), theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/acceso");
        await expect(page.getByRole("heading", { name: /Anotate para la beta/ })).toBeVisible();
        const image = page.locator('[data-ilustracion="acceso"] img');
        await expect(image).toHaveCount(1);
        await expectLoaded(image);
        // Sin recuadro: va sobre el bloque índigo
        const frame = await page
          .locator('[data-ilustracion="acceso"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(frame).toBe("rgba(0, 0, 0, 0)");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: resolve(CAPTURAS, `acceso-${theme}-${width}.png`),
          fullPage: true,
        });
      });
    }
  }

  test("el 404 muestra la escena de error", async ({ page }) => {
    await login(page);
    const res = await page.goto("/esta-pagina-no-existe-124");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    await expectLoaded(page.locator('[data-ilustracion="error"] img'));
    await page.screenshot({ path: resolve(CAPTURAS, "404.png"), fullPage: true });
  });

  test.describe("vitrina (solo admin)", () => {
    test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

    for (const theme of ["claro", "oscuro"] as const) {
      test(`en ${theme}: las ocho escenas, con el recuadro lavanda igual`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem("jso-tema", value), theme);
        await login(page);
        await page.goto("/settings/marca/componentes");
        await expect(page.getByRole("heading", { level: 1, name: "Componentes" })).toBeVisible();
        if (theme === "oscuro") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        for (const scene of SCENES) {
          const frame = page.locator(`[data-ilustracion="${scene}"]`).first();
          await expect(frame, scene).toHaveAttribute("data-ilustracion-estado", "lista");
          await expectLoaded(frame.locator("img"));
          const background = await frame.evaluate((el) => getComputedStyle(el).backgroundColor);
          if (INK_SCENES.includes(scene)) expect(background, scene).toBe("rgba(0, 0, 0, 0)");
          else expect(background, scene).toBe(LAVENDER);
        }
      });
    }

    test("en una pantalla 1x se usa el normal", async ({ page }) => {
      await login(page);
      await page.goto("/settings/marca/componentes");
      const image = page.locator('[data-ilustracion="cv"] img').first();
      await expectLoaded(image);
      const current = await image.evaluate((el: HTMLImageElement) => el.currentSrc);
      expect(current).toMatch(/\/ilustraciones\/cv\.webp$/);
    });

    test.describe("pantalla 2x", () => {
      test.use({ deviceScaleFactor: 2 });
      test("se usa la @2x", async ({ page }) => {
        await login(page);
        await page.goto("/settings/marca/componentes");
        const image = page.locator('[data-ilustracion="cv"] img').first();
        await expectLoaded(image);
        const current = await image.evaluate((el: HTMLImageElement) => el.currentSrc);
        expect(current).toMatch(/\/ilustraciones\/cv@2x\.webp$/);
      });
    });
  });
});
