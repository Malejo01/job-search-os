import { expect, test, type Page } from "@playwright/test";
import { axeSummary } from "./axe-helpers";

/**
 * Flujo 104 (C7-15): lo que faltaba de accesibilidad y rendimiento después del rediseño.
 * - axe en claro y en oscuro en las pantallas sin sesión que no cubrían 61 y 88: legales y cuenta.
 * - En el celular, `/` y `/acceso` (lo que abre el QR del 11/11): sin saltos de layout (CLS < 0,1),
 *   fuentes con `font-display: swap` y botones y campos de 44 px o más.
 */
const AXE_PATHS = [
  "/legal/terminos",
  "/legal/privacidad",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
] as const;

for (const tema of ["claro", "oscuro"] as const) {
  test.describe(`Flujo 104: axe en ${tema}`, () => {
    for (const path of AXE_PATHS) {
      test(`${path} sin violaciones`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, `${path} en ${tema}`).toEqual([]);
        expect(unmeasured, `${path} en ${tema}: contraste sin medir`).toEqual([]);
      });
    }
  });
}

async function layoutShift(page: Page, path: string): Promise<number> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean }
      >) {
        if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

test.describe("Flujo 104: celular liviano", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ["/", "/acceso", "/acceso?origen=voces-jovenes"] as const) {
    test(`${path}: sin saltos de layout`, async ({ page }) => {
      const cls = await layoutShift(page, path);
      expect(cls, `CLS en ${path}`).toBeLessThan(0.1);
    });
  }

  test("las fuentes se muestran con swap: el texto se ve antes de que carguen", async ({
    page,
  }) => {
    await page.goto("/acceso");
    const displays = await page.evaluate(() => {
      const out: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          // Solo las fuentes con archivo: next/font suma @font-face de respaldo (local) sin font-display
          if (
            rule instanceof CSSFontFaceRule &&
            rule.style.getPropertyValue("src").includes("url(")
          )
            out.push(rule.style.getPropertyValue("font-display"));
        }
      }
      return out;
    });
    expect(displays.length).toBeGreaterThan(0);
    expect(displays.every((d) => d === "swap")).toBe(true);
  });

  for (const path of ["/", "/acceso"] as const) {
    test(`${path}: botones y campos de 44 px o más`, async ({ page }) => {
      await page.goto(path);
      const small = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            "main button, main input:not([type=hidden]), main select, main textarea, header a, header button",
          ),
        )
          // Fuera: lo que no se puede tocar (el campo trampa contra bots, oculto y fuera del Tab)
          .filter((el) => el.tabIndex >= 0 && !el.closest('[aria-hidden="true"]'))
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.height < 44;
          })
          .map(
            (el) => `${el.tagName.toLowerCase()} «${(el.textContent ?? "").trim().slice(0, 30)}»`,
          ),
      );
      expect(small, `elementos chicos en ${path}`).toEqual([]);
    });
  }
});
