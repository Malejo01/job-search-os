import { expect, test } from "@playwright/test";

/**
 * Flujo 306 (R28-12): `/ayuda` con las preguntas que faltaban (afinidad, pago y activación, voz, pocas ofertas,
 * cargar una oferta, tope de Interview y contacto), un solo Afi con su burbuja, sin promesas de trabajo ni de
 * «compatibilidad ATS», sin decir que la app postula por vos y sin scroll horizontal a 360 px. Sin sesión.
 * Las preguntas anteriores las cubre el flujo 96.
 */
const NUEVAS = [
  ["afinidad", "¿Cómo se calcula la afinidad?"],
  ["pago", "¿Cómo pago y cuándo se activa el plan?"],
  ["voz", "¿Puedo hablar en vez de escribir? ¿Con qué navegadores?"],
  ["pocas-ofertas", "¿Por qué veo pocas ofertas de mi carrera?"],
  ["cargar-oferta", "¿Cómo cargo una oferta que encontré?"],
  ["tope-interview", "¿Cuántas simulaciones de Interview puedo hacer por día?"],
  ["contacto", "¿A quién le escribo si algo no anda o tengo una duda?"],
] as const;

test.describe("Flujo 306: preguntas frecuentes nuevas (R28-12)", () => {
  test("están las 7 preguntas nuevas, con Afi y sin promesas", async ({ page }) => {
    await page.goto("/ayuda");
    for (const [id, q] of NUEVAS) {
      const articulo = page.getByTestId(`ayuda-faq-${id}`);
      await expect(articulo.getByRole("heading", { level: 2, name: q })).toBeVisible();
    }
    // El tope sale de la constante del código (2), no de un número escrito a mano
    await expect(page.getByTestId("ayuda-faq-tope-interview")).toContainText(
      "Hasta 2 simulaciones completas cada 24 horas",
    );
    // El pago es manual: dice que NO es automático y nunca promete «al instante»
    const pago = page.getByTestId("ayuda-faq-pago");
    await expect(pago).toContainText("Ya pagué");
    await expect(pago).toContainText("a mano");
    await expect(pago).toContainText("No es automático");
    await expect(pago).not.toContainText(/al instante|inmediat/i);

    // Un solo Afi, con su burbuja (la imagen es decorativa)
    await expect(page.getByTestId("afi-dice-ayuda")).toBeVisible();
    await expect(page.getByTestId("afi-dice-ayuda-texto")).toContainText(
      "las dudas que más nos hacen",
    );
    await expect(page.locator("[data-afi]")).toHaveCount(1);
    await expect(page.locator('[data-afi="explicando"]')).toHaveCount(1);

    // Sin promesas (ADR-004 y la regla de no prometer trabajo)
    const main = page.locator("main");
    await expect(main).not.toContainText(/compatibilidad ATS|compatible con ATS/i);
    await expect(main).not.toContainText(/te conseguimos|garantizamos (que|un) (te|trabajo)/i);
    await expect(main).not.toContainText(/se postula por vos autom/i);
    // Lo que sí dice: no se postula por vos
    await expect(main).toContainText("no se postula por vos");
  });

  test("a 360 px no hay scroll horizontal y Afi no tapa el texto", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/ayuda");
    await expect(page.getByTestId("afi-dice-ayuda")).toBeVisible();
    const sobra = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sobra, "scroll horizontal").toBeLessThanOrEqual(0);
    // La burbuja queda debajo de Afi en el celular
    const afi = await page.locator("[data-afi]").first().boundingBox();
    const burbuja = await page.getByTestId("afi-dice-ayuda-burbuja").boundingBox();
    expect(afi && burbuja && burbuja.y >= afi.y + afi.height - 4).toBe(true);
  });
});
