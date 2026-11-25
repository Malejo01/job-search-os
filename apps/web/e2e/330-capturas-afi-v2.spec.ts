import { join } from "node:path";
import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import {
  AFI_SHOTS,
  AFI_THEMES,
  AFI_V2_DIR,
  AFI_WIDTHS,
  afiProblemas,
  afiShot,
  setTheme,
} from "./afi-v2-helpers";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";
import { cleanB, prepareB } from "./voz-helpers";

/**
 * Flujo 330 (R29-08): capturas de Afi v2 en toda la app, a 390 y 1280 px, en claro y en oscuro, en
 * `ops/capturas/r29/afi-v2/después/` (la carpeta no se versiona). Persona B (ficticia). Solo con `CAPTURAS=1` o si
 * existe `ops/capturas/r29/afi-v2/después/.generar`; sin esa señal se saltea.
 *
 * Además de sacar las capturas, cada pantalla revisa por código lo que se puede medir: que la imagen de Afi no
 * salga de la ventana y que cargue. Lo que no se mide (nada tapado, el círculo centrado) se mira en la PNG.
 * Las pantallas apagadas en el entorno (404) se saltean sin fallar.
 *
 * Capturas «antes» (v1): `ops/capturas/r27/` y `r24/`; no se regeneran.
 */
test.describe.configure({ mode: "serial" });
test.skip(!AFI_SHOTS, "sin CAPTURAS=1 ni ops/capturas/r29/afi-v2/después/.generar");
test.use({ reducedMotion: "reduce" });
test.setTimeout(240_000);

const WAIT_TAG = Date.now();

test.afterAll(async () => {
  await cleanB().catch(() => {});
  await removeSecondUser().catch(() => {});
  const { db, close } = ownerDb();
  try {
    await db.delete(s.waitlist).where(like(s.waitlist.email, `afi330-${WAIT_TAG}-%@example.com`));
  } catch {
    // la limpieza no puede tapar el resultado de las pruebas
  } finally {
    await close();
  }
});

const OUT = AFI_V2_DIR;
for (const theme of AFI_THEMES) {
  for (const width of AFI_WIDTHS) {
    const tag = `${width} px en ${theme}`;

    test(`públicas: portada, lista de espera, ayuda y 404 a ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await setTheme(page, theme);
      const problemas: string[] = [];

      await page.goto("/");
      await expect(page.locator('[data-afi="saludando"]')).toBeVisible();
      await afiShot(page, OUT, "01-portada", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `portada: ${p}`));

      await page.goto("/acceso");
      await expect(page.locator("h1").first()).toBeVisible();
      await afiShot(page, OUT, "02-lista-de-espera", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `acceso: ${p}`));

      // La confirmación de la lista de espera trae a Afi trabajando (fila de prueba con `example.com`, se borra al final)
      await page.getByLabel("Nombre").fill("Persona Prueba");
      await page.getByLabel("Email").fill(`afi330-${WAIT_TAG}-${width}-${theme}@example.com`);
      await page.getByRole("radio", { name: "Abogacía" }).check();
      await page.getByRole("button", { name: "Pedir acceso", exact: true }).click();
      await expect(page.getByTestId("acceso-confirmacion")).toBeVisible();
      await expect(page.locator('[data-afi="trabajando"]')).toBeVisible();
      await afiShot(page, OUT, "02b-lista-de-espera-confirmada", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `acceso confirmado: ${p}`));

      await page.goto("/ayuda");
      await expect(page.getByTestId("afi-dice-ayuda")).toBeVisible();
      await afiShot(page, OUT, "03-ayuda", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `ayuda: ${p}`));

      await page.goto("/ruta-que-no-existe-r29");
      await expect(page.locator("[data-afi]").first()).toBeVisible();
      await afiShot(page, OUT, "04-404-publico", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `404: ${p}`));

      expect(problemas).toEqual([]);
    });

    test(`vacíos y Afi que habla a ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await setTheme(page, theme);
      // Persona B sin datos: los estados vacíos
      await removeSecondUser().catch(() => {});
      await ensureSecondUser();
      await loginAsSecondUser(page);
      const problemas: string[] = [];

      const pantallas = [
        { nombre: "10-hoy-saludo", ruta: null, esperar: "mascota-saludo" },
        { nombre: "11-hoy", ruta: "/hoy", esperar: null },
        { nombre: "12-match-vacio", ruta: "/jobs", esperar: null },
        { nombre: "13-interview", ruta: "/interview", esperar: "afi-dice-interview" },
        { nombre: "14-cv-vacio", ruta: "/cv", esperar: null },
        { nombre: "15-cv-armar", ruta: "/cv/armar", esperar: "afi-dice-cv-armar" },
        { nombre: "16-cv-coach", ruta: "/cv/coach", esperar: "afi-dice-cv-coach" },
        { nombre: "17-tracker-vacio", ruta: "/applications", esperar: null },
        { nombre: "18-academy", ruta: "/academy", esperar: null },
        { nombre: "19-inbox-vacio", ruta: "/inbox", esperar: null },
        { nombre: "20-404-con-sesion", ruta: "/ruta-que-no-existe-r29", esperar: null },
      ] as const;

      for (const { nombre, ruta, esperar } of pantallas) {
        if (ruta) {
          const res = await page.goto(ruta);
          if (res?.status() === 404 && !nombre.includes("404")) continue; // apagada en este entorno
        }
        await expect(page.locator("h1, [data-afi]").first()).toBeVisible();
        if (esperar) await expect(page.getByTestId(esperar).first()).toBeVisible();
        await afiShot(page, OUT, nombre, width, theme);
        problemas.push(...(await afiProblemas(page)).map((p) => `${nombre}: ${p}`));
      }
      expect(problemas).toEqual([]);
    });

    test(`con datos: Tracker, Preparar, festejo y Hoy a ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await setTheme(page, theme);
      const data = await seedSecondUserData(`330-${width}-${theme}`);
      const { db, close } = ownerDb();
      try {
        await db
          .update(s.profiles)
          .set({ saludoVisto: null })
          .where(eq(s.profiles.userId, E2E_B_USER_ID));
      } finally {
        await close();
      }
      await loginAsSecondUser(page);
      const problemas: string[] = [];

      await expect(page.getByTestId("mascota-saludo")).toBeVisible();
      await afiShot(page, OUT, "30-hoy-con-datos-saludo", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `hoy: ${p}`));

      await page.goto("/jobs");
      await expect(page.locator("h1").first()).toBeVisible();
      await afiShot(page, OUT, "31-match-con-oferta", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `match: ${p}`));

      await page.goto("/applications");
      await expect(page.locator("h1").first()).toBeVisible();
      await afiShot(page, OUT, "32-tracker", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `tracker: ${p}`));

      const res = await page.goto(`/jobs/${data.jobId}/postular`);
      if (res?.status() !== 404) {
        await expect(page.locator("h1").first()).toBeVisible();
        await afiShot(page, OUT, "33-preparar", width, theme);
        problemas.push(...(await afiProblemas(page)).map((p) => `preparar: ${p}`));
      }

      // Festejo: marcar la oferta como aplicada
      const { db: db2, close: close2 } = ownerDb();
      try {
        await db2.delete(s.applications).where(eq(s.applications.userId, E2E_B_USER_ID));
        await db2.update(s.jobs).set({ status: "evaluada" }).where(eq(s.jobs.id, data.jobId));
      } finally {
        await close2();
      }
      await page.goto(`/jobs/${data.jobId}`);
      // Esperar la hidratación: un clic antes de que el botón tenga su manejador no festeja
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Marcar aplicada" }).click();
      await expect(page.getByTestId("festejo")).toBeVisible();
      await afiShot(page, OUT, "34-festejo", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `festejo: ${p}`));

      expect(problemas).toEqual([]);
    });

    test(`asistente e Interview con sesión a ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await setTheme(page, theme);
      const sessionId = await prepareB("Simulación ficticia de las capturas de Afi v2");
      await loginAsSecondUser(page);
      const problemas: string[] = [];

      await page.goto("/hoy");
      await expect(page.getByTestId("asistente-mascota")).toBeVisible();
      await afiShot(page, OUT, "40-boton-asistente", width, theme);
      // La cara del botón: dentro de su círculo, sin cortes
      const cara = page
        .getByTestId("asistente-mascota")
        .locator('[data-afi="cara"]:visible')
        .first();
      await expect(cara).toBeVisible();
      await cara.screenshot({
        path: join(OUT, `41-cara-recorte-${width}-${theme}.png`),
      });

      await page.getByTestId("asistente-mascota").click();
      await expect(page.getByTestId("assistant-panel")).toBeVisible();
      await afiShot(page, OUT, "42-asistente-abierto", width, theme);
      await page.keyboard.press("Escape");

      await page.goto(`/interview/${sessionId}`);
      await expect(page.getByTestId("interview-progress-label")).toBeVisible();
      await afiShot(page, OUT, "43-interview-pregunta", width, theme);
      problemas.push(...(await afiProblemas(page)).map((p) => `interview: ${p}`));

      expect(problemas).toEqual([]);
    });
  }
}
