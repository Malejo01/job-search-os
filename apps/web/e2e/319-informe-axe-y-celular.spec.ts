import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { INFORME_URL, clearReportsOf, makePdf, seedDraft } from "./informe-helpers";

/**
 * Flujo 319 (R29-03): `/recorrido/informe` y el modal con «Agregar al informe» a 1280, 390 y 360 px: sin scroll
 * horizontal, axe sin violaciones serias en claro y oscuro (también con el diálogo de confirmación abierto) y todo
 * usable con el teclado. Datos inventados.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
});
test.beforeEach(async () => {
  await clearReportsOf();
});
test.afterAll(async () => {
  await clearReportsOf();
  await removeSecondUser();
});

const ANCHOS = [1280, 390, 360] as const;

async function sinScrollHorizontal(page: Page) {
  const { ancho, scroll } = await page.evaluate(() => ({
    ancho: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(ancho);
}

async function axeSerias(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

async function ponerTema(page: Page, tema: "claro" | "oscuro") {
  await page.evaluate((t) => {
    localStorage.setItem("jso-tema", t);
    document.documentElement.classList.toggle("dark", t === "oscuro");
  }, tema);
}

for (const ancho of ANCHOS) {
  test(`la pantalla a ${ancho} px: sin scroll horizontal y sin violaciones serias de axe`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await seedDraft(["Ítem ficticio 319 con texto", "Otro ítem ficticio 319"]);
    await loginAsSecondUser(page);
    await page.goto(INFORME_URL);
    const item = page.getByTestId("informe-item-1");
    await expect(item).toBeVisible();
    await item.getByTestId("informe-archivo").setInputFiles({
      name: "nota-319.pdf",
      mimeType: "application/pdf",
      buffer: makePdf(),
    });
    await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 15_000 });

    await sinScrollHorizontal(page);
    expect(await axeSerias(page)).toEqual([]);

    await ponerTema(page, "oscuro");
    expect(await axeSerias(page)).toEqual([]);
    await ponerTema(page, "claro");

    // Con el diálogo de confirmación abierto
    await page.getByTestId("informe-enviar").click();
    await expect(page.getByTestId("informe-confirmar")).toBeVisible();
    await sinScrollHorizontal(page);
    expect(await axeSerias(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("informe-confirmar")).toBeHidden();
  });

  test(`el modal con «Agregar al informe» a ${ancho} px: botones a la vista, sin scroll horizontal y axe limpio`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    await loginAsSecondUser(page);
    await page.goto("/hoy");
    await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    const agregar = dialog.getByTestId("feedback-agregar-informe");
    await expect(agregar).toBeVisible();
    const caja = await agregar.boundingBox();
    expect(caja!.x).toBeGreaterThanOrEqual(0);
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(ancho);
    await sinScrollHorizontal(page);
    expect(await axeSerias(page)).toEqual([]);
  });
}

test("con el teclado: agregar un ítem, escribir, y recorrer los botones sin trampas", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  const agregar = page.getByTestId("informe-agregar");
  await agregar.focus();
  await page.keyboard.press("Enter");
  const campo = page.getByTestId("informe-item-1").getByTestId("informe-mensaje");
  // El foco pasa solo al texto del ítem nuevo
  await expect(campo).toBeFocused();
  await page.keyboard.type("Texto ficticio 319 escrito con el teclado");

  // Shift+Tab y Tab llegan a la pantalla, el tipo y los botones del ítem, en orden
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("informe-item-1").getByLabel("Tipo de comentario")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("informe-item-1").getByLabel("Pantalla")).toBeFocused();

  // «Enviar informe» se alcanza y abre el diálogo; Esc lo cierra y devuelve el foco
  const enviar = page.getByTestId("informe-enviar");
  await enviar.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("informe-confirmar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("informe-confirmar")).toBeHidden();
  await expect(enviar).toBeFocused();
});
