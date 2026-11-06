import { expect, test, type Locator } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 114: las ilustraciones de la serie E2 (`ilustraciones.md`, junto al manual de marca en docs/ux).
 *
 * Qué prueba:
 * - Los dos archivos de cada escena se sirven sin sesión (el middleware no los manda a /login:
 *   /acceso y el 404 se ven antes de entrar).
 * - /acceso muestra la suya decorativa (`alt=""`), cargada y sin desbordar el celular.
 * - En /ui, las ocho: decorativas, cargadas, con el recuadro lavanda `#EEEDF9` igual en claro y en
 *   oscuro (las de fondo índigo, sin recuadro) y con el archivo `@2x` solo en pantallas de 2x.
 * - El 404 de una persona con sesión muestra la escena `error`.
 *
 * El axe de cada pantalla (claro y oscuro) lo hacen los flujos 61, 70, 87 y 88: /ui ya lista las
 * ocho escenas. Sin datos de nadie.
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
const INK_SCENES = ["hoy", "acceso"];
/** `#EEEDF9` como lo devuelve getComputedStyle. */
const LAVENDER = "rgb(238, 237, 249)";

async function expectLoaded(image: Locator): Promise<void> {
  await expect(image).toHaveAttribute("alt", "");
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

test.describe("Flujo 114: ilustraciones", () => {
  test("los dos archivos de cada escena se sirven sin sesión", async ({ request }) => {
    for (const scene of SCENES) {
      for (const name of [`${scene}.webp`, `${scene}@2x.webp`]) {
        const res = await request.get(`/ilustraciones/${name}`, { maxRedirects: 0 });
        expect(res.status(), name).toBe(200);
        expect(res.headers()["content-type"], name).toContain("image/webp");
      }
    }
  });

  test("/acceso: la escena es decorativa, carga y no desborda el celular", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/acceso");
    await expect(page.getByRole("heading", { name: "Pedir acceso" })).toBeVisible();
    const image = page.locator('[data-illustration="acceso"] img');
    await expect(image).toHaveCount(1);
    await expectLoaded(image);
    // Sin recuadro: va sobre el bloque índigo
    const frame = await page
      .locator('[data-illustration="acceso"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(frame).toBe("rgba(0, 0, 0, 0)");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("el 404 muestra la escena de error", async ({ page }) => {
    await login(page);
    const res = await page.goto("/esta-pagina-no-existe-114");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();
    await expectLoaded(page.locator('[data-illustration="error"] img'));
  });

  for (const theme of ["claro", "oscuro"] as const) {
    test(`/ui en ${theme}: las ocho escenas, con el recuadro lavanda igual`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("jso-tema", value), theme);
      await login(page);
      await page.goto("/ui");
      await expect(page.getByRole("heading", { level: 1, name: "Componentes" })).toBeVisible();
      if (theme === "oscuro") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      for (const scene of SCENES) {
        const frame = page.locator(`[data-illustration="${scene}"]`);
        await expect(frame, scene).toHaveCount(1);
        await expectLoaded(frame.locator("img"));
        const background = await frame.evaluate((el) => getComputedStyle(el).backgroundColor);
        if (INK_SCENES.includes(scene)) expect(background, scene).toBe("rgba(0, 0, 0, 0)");
        else expect(background, scene).toBe(LAVENDER);
      }
    });
  }

  test.describe("srcSet con los dos archivos", () => {
    test("en una pantalla 1x se usa el normal", async ({ page }) => {
      await login(page);
      await page.goto("/ui");
      const image = page.locator('[data-illustration="cv"] img');
      await expectLoaded(image);
      const current = await image.evaluate((el: HTMLImageElement) => el.currentSrc);
      expect(current).toMatch(/\/ilustraciones\/cv\.webp$/);
    });

    test.describe("pantalla 2x", () => {
      test.use({ deviceScaleFactor: 2 });
      test("se usa la @2x", async ({ page }) => {
        await login(page);
        await page.goto("/ui");
        const image = page.locator('[data-illustration="cv"] img');
        await expectLoaded(image);
        const current = await image.evaluate((el: HTMLImageElement) => el.currentSrc);
        expect(current).toMatch(/\/ilustraciones\/cv@2x\.webp$/);
      });
    });
  });
});
