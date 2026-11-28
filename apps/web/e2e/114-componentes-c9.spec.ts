import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 114 (C9-3): /admin/marca/componentes, el catálogo de primitivas del rediseño, solo para
 * quien administra la beta. Claro y oscuro van lado a lado: un pase de axe revisa los dos. También
 * verifica la forma P1: el botón principal lleva un borde inferior de 6 px y se hunde al tocarlo
 * sin mover lo que tiene alrededor.
 */
test.describe("Flujo 114: catálogo de componentes del rediseño", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  for (const width of [390, 1280]) {
    test(`a ${width} px: los dos modos, sin violaciones de axe ni scroll horizontal`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await page.goto("/admin/marca");
      await page
        .getByRole("link", { name: "Ver los componentes del rediseño en todos sus estados" })
        .click();
      await expect(page).toHaveURL(/\/admin\/marca\/componentes$/);
      await expect(page.getByRole("heading", { level: 1, name: "Componentes" })).toBeVisible();
      await expect(page.getByRole("region", { name: "En claro" })).toBeVisible();
      await expect(page.getByRole("region", { name: "En oscuro" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }

  test("el botón principal tiene borde inferior de 5 px y se hunde 3 px sin mover el layout", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto("/admin/marca/componentes");
    const button = page
      .getByRole("region", { name: "En claro" })
      .getByRole("button", { name: "Ver mis ofertas" });
    const next = page
      .getByRole("region", { name: "En claro" })
      .getByRole("button", { name: "Guardar", exact: true });
    expect(await button.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("5px");
    await button.scrollIntoViewIfNeeded();
    const before = await next.boundingBox();
    const box = await button.boundingBox();
    if (!box || !before) throw new Error("sin caja");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await button.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("2px");
    // Lo de abajo no salta mientras está apretado
    expect((await next.boundingBox())?.y).toBe(before.y);
    await page.mouse.up();
  });

  test("sello (R30-02): «Afinidad alta» es el único inclinado, la palabra y el número siempre están y todos son círculos", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/marca/componentes");
    const seals = page.getByTestId("sellos-light");
    const top = seals.getByRole("img", { name: "puntaje 9.2" });
    await expect(top).toContainText("Afinidad alta");
    // El número lleva un decimal y coma
    await expect(top).toContainText("9,2");
    // Tailwind 4 inclina con la propiedad `rotate`, no con `transform`
    const girar = (seal: typeof top) =>
      seal.locator("[data-seal-circle]").evaluate((el) => getComputedStyle(el).rotate);
    expect(await girar(top)).toBe("-8deg");
    const far = seals.getByRole("img", { name: "puntaje 1.5" });
    await expect(far).toContainText("Afinidad baja");
    expect(await girar(far)).toBe("none");
    for (const name of [
      "puntaje 7.5",
      "puntaje 5.5",
      "puntaje 3.5",
      "puntaje 6.9",
      "sin evaluar",
      "en cola",
    ]) {
      const seal = seals.getByRole("img", { name });
      await expect(seal).toBeVisible();
      expect(await girar(seal)).toBe(name === "puntaje 7.5" ? "-8deg" : "none");
    }
    await expect(seals.getByRole("img", { name: "puntaje 7.5" })).toContainText("Afinidad alta");
    await expect(seals.getByRole("img", { name: "puntaje 5.5" })).toContainText("Afinidad media");
    // Un 6,9 es media: el número nunca contradice al sello
    await expect(seals.getByRole("img", { name: "puntaje 6.9" })).toContainText("Afinidad media");
    await expect(seals.getByRole("img", { name: "puntaje 3.5" })).toContainText("Afinidad baja");
    await expect(seals.getByRole("img", { name: "sin evaluar" })).toContainText("Sin evaluar");
    // La palabra va debajo del círculo (que sigue siendo un círculo), a 12 px o más y sin desbordar el sello
    const word = far.getByText("Afinidad");
    const size = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
    const circle = far.locator("[data-seal-circle]");
    const [wordBox, sealBox, circleBox] = [
      await word.boundingBox(),
      await far.boundingBox(),
      await circle.boundingBox(),
    ];
    if (!wordBox || !sealBox || !circleBox) throw new Error("sin caja");
    expect(Math.round(circleBox.width)).toBe(Math.round(circleBox.height));
    expect(wordBox.y).toBeGreaterThanOrEqual(circleBox.y + circleBox.height - 1);
    expect(wordBox.x).toBeGreaterThanOrEqual(sealBox.x - 1);
    expect(wordBox.x + wordBox.width).toBeLessThanOrEqual(sealBox.x + sealBox.width + 1);
    expect(wordBox.y + wordBox.height).toBeLessThanOrEqual(sealBox.y + sealBox.height + 1);
  });
});
