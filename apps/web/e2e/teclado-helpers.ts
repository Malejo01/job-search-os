import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Ayudas de los flujos 294 a 299 (R28-08): recorridos solo con teclado. Las mismas ideas que el flujo 79,
 * pero exportadas y pensadas para la persona B (la base local no tiene usuario del seed).
 */
export const MAX_TABS = 250;

/** Aprieta Tab hasta que `target` tenga el foco. Devuelve cuántas veces hizo falta. */
export async function tabTo(page: Page, target: Locator, label: string): Promise<number> {
  await target.waitFor({ state: "attached" });
  for (let presses = 1; presses <= MAX_TABS; presses += 1) {
    await page.keyboard.press("Tab");
    const focused = await target
      .evaluate((el) => el === el.ownerDocument.activeElement)
      .catch(() => false);
    if (focused) return presses;
  }
  throw new Error(`«${label}» no se alcanza con Tab (${MAX_TABS} intentos)`);
}

/** ¿Se ve el foco? `outline` (también el `auto` del navegador) o `box-shadow` distintos de `none`. */
export async function focusState(page: Page): Promise<{ visible: boolean; who: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { visible: false, who: "body (sin foco)" };
    const css = getComputedStyle(el);
    const invisibleColor = /^rgba?\(255, 255, 255(, 1)?\)$|^rgba\(0, 0, 0, 0\)$|^transparent$/;
    const outline =
      css.outlineStyle !== "none" &&
      css.outlineStyle !== "hidden" &&
      (css.outlineStyle === "auto" || parseFloat(css.outlineWidth) > 0) &&
      (css.outlineStyle === "auto" || !invisibleColor.test(css.outlineColor));
    const shadow = css.boxShadow !== "none";
    const name = el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.id ?? "";
    return {
      visible: outline || shadow,
      who: `${el.tagName.toLowerCase()}${name ? ` «${name}»` : ""}`,
    };
  });
}

export async function expectFocusVisible(page: Page, step: string): Promise<void> {
  const { visible, who } = await focusState(page);
  expect(visible, `foco invisible en «${step}»: ${who}`).toBe(true);
}

/** Tab hasta el elemento, verifica que lo tenga y que se vea. */
export async function reach(page: Page, target: Locator, step: string): Promise<void> {
  await tabTo(page, target, step);
  await expect(target, `«${step}» con foco`).toBeFocused();
  await expectFocusVisible(page, step);
}

/**
 * Con un modal abierto, varias vueltas de Tab (y de Mayús+Tab) no salen a la página de atrás. Al pasar el
 * último elemento el navegador puede dejar el foco en su propia barra (`body`): nunca en la página.
 */
export async function expectFocusTrapped(page: Page, dialog: Locator, vueltas = 14): Promise<void> {
  for (let i = 0; i < vueltas; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await dialog.evaluate((el) => {
      const a = el.ownerDocument.activeElement;
      return a === el.ownerDocument.body || el.contains(a);
    });
    expect(inside, `Tab ${i + 1}: el foco salió del diálogo`).toBe(true);
  }
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Shift+Tab");
    const inside = await dialog.evaluate((el) => {
      const a = el.ownerDocument.activeElement;
      return a === el.ownerDocument.body || el.contains(a);
    });
    expect(inside, `Mayús+Tab ${i + 1}: el foco salió del diálogo`).toBe(true);
  }
}

/** El foco está dentro de `scope` (no en el `body`). */
export async function expectFocusInside(scope: Locator, step: string): Promise<void> {
  const inside = await scope.evaluate((el) => {
    const a = el.ownerDocument.activeElement;
    return !!a && a !== el.ownerDocument.body && el.contains(a);
  });
  expect(inside, `${step}: el foco tiene que estar adentro`).toBe(true);
}
