import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { settleBrandMotion } from "./axe-helpers";
import { loginAsSecondUser, removeSecondUser } from "./helpers";
import { cleanB, prepareB } from "./voz-helpers";

/**
 * Flujo 266 (R27-07): axe sin violaciones serias (serious o critical) en las pantallas con Afi, en claro y
 * oscuro, a 390 px. Las moderadas y leves quedan como anotación, igual que en el flujo 131. Portada y 404
 * sin sesión; Hoy, el asistente abierto, un vacío (CV), Interview y Academy con la persona B.
 */
const TEMAS = ["claro", "oscuro"] as const;

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.afterAll(async () => {
  await cleanB().catch(() => {});
  await removeSecondUser().catch(() => {});
});

async function revisar(page: Page, etiqueta: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await settleBrandMotion(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const resumir = (impactos: string[]) =>
    result.violations
      .filter((v) => impactos.includes(v.impact ?? ""))
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  const leves = resumir(["moderate", "minor"]);
  if (leves.length > 0) {
    console.log(`[a11y-leves] ${etiqueta}: ${leves.join("; ")}`);
    test
      .info()
      .annotations.push({ type: "a11y-leves", description: `${etiqueta}: ${leves.join("; ")}` });
  }
  expect(resumir(["serious", "critical"]), `axe serious/critical en ${etiqueta}`).toEqual([]);
}

for (const tema of TEMAS) {
  test(`portada y 404 (${tema})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
    await page.goto("/");
    await expect(page.locator('[data-afi="saludando"]')).toBeVisible();
    await revisar(page, `portada (${tema})`);
    await page.goto("/ruta-que-no-existe-r27");
    await expect(page.locator("[data-afi]").first()).toBeVisible();
    await revisar(page, `404 (${tema})`);
  });

  test(`Hoy, asistente abierto, vacío, Interview y Academy (${tema})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
    const sessionId = await prepareB("Simulación ficticia de axe");
    await loginAsSecondUser(page);

    await page.goto("/hoy");
    await expect(page.getByTestId("asistente-mascota")).toBeVisible();
    await revisar(page, `Hoy (${tema})`);

    await page.getByTestId("asistente-mascota").click();
    await expect(page.getByTestId("assistant-panel")).toBeVisible();
    await revisar(page, `asistente abierto (${tema})`);
    await page.keyboard.press("Escape");

    await page.goto("/cv");
    await revisar(page, `vacío del CV (${tema})`);

    await page.goto(`/interview/${sessionId}`);
    await expect(page.getByTestId("interview-progress-label")).toBeVisible();
    await revisar(page, `Interview (${tema})`);

    await page.goto("/academy");
    await expect(page.locator("h1").first()).toBeVisible();
    await revisar(page, `Academy (${tema})`);
  });
}
