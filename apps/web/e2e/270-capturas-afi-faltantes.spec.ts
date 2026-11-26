import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 270 (R28-01): las dos capturas de la R27 que faltaban, el festejo y Hoy con el saludo, a 390 y 1280 px,
 * en claro y en oscuro, en `ops/capturas/r27/` (la carpeta no se versiona). Persona B (ficticia). Solo con
 * `CAPTURAS=1` o si existe `ops/capturas/r27/.generar`; sin esa señal se saltea.
 *
 * Con `reducedMotion: "reduce"` para que la caja y la imagen no estén a mitad de una animación de escala.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r27");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;

test.describe.configure({ mode: "serial" });
test.skip(!SHOTS, "sin CAPTURAS=1 ni ops/capturas/r27/.generar");
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
    test(`Hoy con el saludo a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      // Etiqueta única por prueba: la oferta tiene una URL única por persona (`jobs_user_url`)
      await seedSecondUserData(`270-hoy-${width}-${theme}`);
      const { db, close } = ownerDb();
      try {
        // El saludo sale la primera vez del día: sin día guardado en la cuenta
        await db
          .update(s.profiles)
          .set({ saludoVisto: null })
          .where(eq(s.profiles.userId, E2E_B_USER_ID));
      } finally {
        await close();
      }
      await loginAsSecondUser(page);
      await expect(page.getByTestId("mascota-saludo")).toBeVisible();
      await shot(page, "08-hoy-con-saludo", width, theme);
    });

    test(`festejo a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      const data = await seedSecondUserData(`270-festejo-${width}-${theme}`);
      const { db, close } = ownerDb();
      try {
        await db.delete(s.applications).where(eq(s.applications.userId, E2E_B_USER_ID));
        await db.update(s.jobs).set({ status: "evaluada" }).where(eq(s.jobs.id, data.jobId));
      } finally {
        await close();
      }
      await loginAsSecondUser(page);
      await page.goto(`/jobs/${data.jobId}`);
      await page.getByRole("button", { name: "Ya me postulé" }).click();
      await expect(page.getByTestId("festejo")).toBeVisible();
      await shot(page, "09-festejo", width, theme);
    });
  }
}
