import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 114 (C9-3): /settings/marca/componentes, el catálogo de primitivas del rediseño, solo para
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
      await page.goto("/settings/marca");
      await page
        .getByRole("link", { name: "Ver los componentes del rediseño en todos sus estados" })
        .click();
      await expect(page).toHaveURL(/\/settings\/marca\/componentes$/);
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

  test("el botón principal tiene borde inferior de 6 px y se hunde 3 px sin mover el layout", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto("/settings/marca/componentes");
    const button = page
      .getByRole("region", { name: "En claro" })
      .getByRole("button", { name: "Ver mis ofertas" });
    const next = page
      .getByRole("region", { name: "En claro" })
      .getByRole("button", { name: "Guardar", exact: true });
    expect(await button.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("6px");
    const before = await next.boundingBox();
    const box = await button.boundingBox();
    if (!box || !before) throw new Error("sin caja");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await button.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe("3px");
    // Lo de abajo no salta mientras está apretado
    expect((await next.boundingBox())?.y).toBe(before.y);
    await page.mouse.up();
  });

  test("sello (C9-5): «Muy afín» es el único inclinado, la palabra siempre está y no baja de 10 px", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings/marca/componentes");
    const seals = page.getByTestId("sellos-light");
    const top = seals.getByRole("img", { name: "puntaje 9.2" });
    await expect(top).toContainText("Muy afín");
    expect(await top.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
    const far = seals.getByRole("img", { name: "puntaje 1.5" });
    await expect(far).toContainText("Lejos de tu perfil");
    expect(await far.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    for (const name of [
      "puntaje 7.5",
      "puntaje 5.5",
      "puntaje 3.5",
      "estimación previa 6",
      "sin evaluar",
      "en cola",
    ]) {
      const seal = seals.getByRole("img", { name });
      await expect(seal).toBeVisible();
      expect(await seal.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    }
    await expect(seals.getByRole("img", { name: "puntaje 7.5" })).toContainText("Bastante afín");
    await expect(seals.getByRole("img", { name: "puntaje 5.5" })).toContainText("Afín a medias");
    await expect(seals.getByRole("img", { name: "puntaje 3.5" })).toContainText("Poco afín");
    await expect(seals.getByRole("img", { name: "estimación previa 6" })).toContainText("Estimado");
    await expect(seals.getByRole("img", { name: "sin evaluar" })).toContainText("Sin evaluar");
    // La palabra de «Lejos de tu perfil» entra en el sello sin bajar de 10 px ni desbordar
    const word = far.getByText("Lejos de tu perfil");
    const size = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(10);
    const [wordBox, sealBox] = [await word.boundingBox(), await far.boundingBox()];
    if (!wordBox || !sealBox) throw new Error("sin caja");
    expect(wordBox.x).toBeGreaterThanOrEqual(sealBox.x);
    expect(wordBox.x + wordBox.width).toBeLessThanOrEqual(sealBox.x + sealBox.width);
    expect(wordBox.y + wordBox.height).toBeLessThanOrEqual(sealBox.y + sealBox.height);
  });
});
