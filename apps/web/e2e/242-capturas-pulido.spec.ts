import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { settleBrandMotion } from "./axe-helpers";
import { E2E_B_USER_ID, loginAsSecondUser, ownerDb, removeSecondUser } from "./helpers";
import { cleanB, prepareB } from "./voz-helpers";

/**
 * Flujo 242 (R26-05): capturas del pulido del celular, a 390 y 1280 px, en claro y en oscuro, con la persona B
 * (ficticia, tester: ve la mascota del asistente). Solo con `CAPTURAS=1` o si existe `ops/capturas/r26/.generar`;
 * sin esa señal se saltea (no es una aserción de la pantalla). El nombre lleva la etapa: `CAPTURAS_ETAPA=antes`
 * (se corre contra el árbol de antes del ticket, en un worktree) o, por defecto, `despues`.
 *
 * Pantallas: Hoy con el aviso inicial del asistente a la vista, la pregunta de Interview (el contador y la
 * mascota) y, con `PRICING_ENABLED=1`, Hoy con el aviso de vencimiento. Se guardan en `ops/capturas/r26/`
 * (la carpeta no se versiona).
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r26");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));
const ETAPA = process.env.CAPTURAS_ETAPA === "antes" ? "antes" : "despues";
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;

test.describe.configure({ mode: "serial" });
test.skip(!SHOTS, "sin CAPTURAS=1 ni ops/capturas/r26/.generar");
test.setTimeout(90_000);

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
  await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}-${ETAPA}.png`) });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`Hoy y Interview a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      const sessionId = await prepareB("Simulación ficticia de las capturas");
      await loginAsSecondUser(page);

      // Hoy con el aviso inicial «Preguntame lo que quieras» (sale a los 0,8 s, una vez por navegador)
      await page.goto("/hoy");
      await expect(page.getByTestId("asistente-mascota")).toBeVisible();
      await page.waitForTimeout(1200);
      await shot(page, "01-hoy-aviso-asistente", width, theme);

      // Interview: el contador de la pregunta y la mascota
      await page.goto(`/interview/${sessionId}`);
      await expect(page.getByTestId("interview-progress-label")).toBeVisible();
      await shot(page, "02-interview-pregunta", width, theme);
      await page.getByTestId("interview-answer").click();
      await page.getByTestId("interview-answer").fill("Una respuesta ficticia para la captura.");
      await shot(page, "03-interview-escribiendo", width, theme);
      await page.getByTestId("interview-answer").blur();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await shot(page, "04-interview-final-de-pagina", width, theme);
    });

    test(`Hoy con el aviso de vencimiento a ${width} px en ${theme}`, async ({ page }) => {
      test.skip(process.env.PRICING_ENABLED !== "1", "necesita PRICING_ENABLED=1 en el servidor");
      await prepareB("Simulación ficticia de las capturas");
      const { db, close } = ownerDb();
      try {
        await db
          .update(s.profiles)
          .set({
            plan: "lista",
            planSource: "pago",
            planUntil: new Date(Date.now() + 2 * 86_400_000),
          })
          .where(eq(s.profiles.userId, E2E_B_USER_ID));
      } finally {
        await close();
      }
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      await loginAsSecondUser(page);
      await expect(page.getByTestId("aviso-plan")).toBeVisible();
      await shot(page, "05-hoy-aviso-vencimiento", width, theme);
    });
  }
}
