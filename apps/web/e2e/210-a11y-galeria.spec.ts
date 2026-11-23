import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { loginAsSecondUser, removeSecondUser, seedSecondUserData } from "./helpers";

/**
 * Flujo 210 (R24-03): lo que axe no mide por defecto, sobre las pantallas principales con la persona B
 * (ficticia, solo en la base local). Corre en serie y usa a B: no correrlo junto con 180 a 182, 186 ni 200.
 *
 * 1. La medición es real: se inyecta una violación conocida y `axeSummary` la tiene que ver.
 * 2. `target-size` de WCAG 2.2 (axe, mínimo de 24 px) en todas las pantallas.
 * 3. Objetivos de 44 px que pide la marca, a 390 px (los enlaces dentro de un párrafo quedan exceptuados,
 *    como en WCAG).
 * 4. Foco visible en los primeros Tab de cada pantalla.
 * 5. Con `prefers-reduced-motion: reduce`, ninguna animación corriendo.
 */
const TAG = `210-${Date.now()}`;
let jobId = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

function screens(): Array<[string, string]> {
  return [
    ["hoy", "/hoy"],
    ["match", "/jobs?estado=todas"],
    ["oferta", `/jobs/${jobId}`],
    ["preparar", `/jobs/${jobId}/postular`],
    ["tracker", "/applications"],
    ["cv", "/cv"],
    ["interview", "/interview"],
    ["academy", "/academy"],
    ["ajustes", "/settings"],
  ];
}

async function open(page: Page, path: string): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading").first(), path).toBeVisible();
  // Las herramientas de desarrollo de Next no son parte de la app
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

test.beforeAll(async () => {
  const data = await seedSecondUserData(TAG);
  jobId = data.jobId;
});

test.afterAll(async () => {
  await removeSecondUser();
});

test.describe("axe y movimiento", () => {
  test("la medición es real: una violación conocida aparece", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsSecondUser(page);
    await open(page, "/hoy");

    // Pantalla limpia: sin violaciones y con el contraste realmente medido
    const limpia = await axeSummary(page, ['[data-logo-fondo="accent"]']);
    expect(limpia.violations, "pantalla limpia").toEqual([]);
    expect(limpia.unmeasured, "contraste sin medir").toEqual([]);

    // Violaciones conocidas e inyectadas: imagen sin alt, botón sin nombre y texto casi invisible
    await page.evaluate(() => {
      const box = document.createElement("div");
      box.id = "inyectado-a11y";
      box.innerHTML =
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">' +
        "<button></button>" +
        '<p style="color:#eee;background:#fff">texto ficticio de bajo contraste</p>';
      document.body.prepend(box);
    });
    const con = await axeSummary(page, ['[data-logo-fondo="accent"]']);
    const reglas = con.violations.map((v) => v.split(" ")[0]);
    expect(reglas).toEqual(expect.arrayContaining(["image-alt", "button-name", "color-contrast"]));
    // Reporta impacto: no se filtra por severidad
    expect(con.violations.join("\n")).toMatch(/\((minor|moderate|serious|critical)\)/);
  });

  for (const width of [390, 1280]) {
    test(`target-size (WCAG 2.2) a ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await loginAsSecondUser(page);
      const fallas: string[] = [];
      for (const [name, path] of screens()) {
        await open(page, path);
        const result = await new AxeBuilder({ page })
          .withTags(["wcag22aa"])
          .exclude("nextjs-portal")
          .analyze();
        const reglas = [...result.passes, ...result.violations, ...result.incomplete].map(
          (r) => r.id,
        );
        expect(reglas, `${name}: axe no trae target-size`).toContain("target-size");
        for (const v of result.violations) {
          fallas.push(
            `${name} ${width}: ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
          );
        }
      }
      expect(fallas, fallas.join("\n")).toEqual([]);
    });
  }

  test("objetivos de 44 px que pide la marca, a 390 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await loginAsSecondUser(page);
    const chicos: string[] = [];
    for (const [name, path] of screens()) {
      await open(page, path);
      const found = await page.evaluate(() => {
        const MIN = 43.5;
        const out: string[] = [];
        const sel =
          'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="link"]';
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          if (el.closest("nextjs-portal")) continue;
          const css = getComputedStyle(el);
          if (css.display === "none" || css.visibility === "hidden") continue;
          const box = el.getBoundingClientRect();
          // Tamaño de layout (sin la escala de una animación de entrada que aún no terminó). No se
          // cuentan márgenes invisibles: el objetivo tiene que medir 44 px de verdad.
          const sizeOf = (node: HTMLElement) => {
            const c = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            const w = c.display === "inline" ? rect.width : node.offsetWidth;
            const h = c.display === "inline" ? rect.height : node.offsetHeight;
            return { w, h };
          };
          // Un campo con etiqueta (envolvente o con `for`) se toca por la etiqueta: se mide esa. Una
          // etiqueta de al menos 44 px de alto (fila completa) alcanza.
          const labels =
            el instanceof HTMLInputElement || el instanceof HTMLSelectElement
              ? Array.from(el.labels ?? []).filter(
                  (l) => getComputedStyle(l).display !== "none" && l.offsetHeight > 1,
                )
              : [];
          if (labels.some((l) => sizeOf(l).h >= MIN)) continue;
          // Ocultos solo para lector (sr-only) y sin etiqueta visible, o fuera de la pantalla
          if (labels.length === 0 && (box.width <= 1 || box.height <= 1)) continue;
          // Enlace dentro de un párrafo: exceptuado (WCAG 2.5.8)
          if (el.tagName === "A" && css.display === "inline") {
            const parent = el.parentElement;
            if (
              parent &&
              (parent.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 8
            )
              continue;
          }
          const { w, h } = sizeOf(el);
          if (Math.min(w, h) >= MIN) continue;
          const label =
            el.getAttribute("aria-label") ||
            el.getAttribute("data-testid") ||
            (el.textContent ?? "").trim().slice(0, 30) ||
            el.tagName.toLowerCase();
          out.push(`${el.tagName.toLowerCase()}[${label}] ${Math.round(w)}x${Math.round(h)}`);
        }
        return out;
      });
      for (const f of found) chicos.push(`${name}: ${f}`);
    }
    expect.soft(chicos, `objetivos menores a 44 px:\n${chicos.join("\n")}`).toEqual([]);
  });

  test("foco visible en los primeros Tab de cada pantalla", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsSecondUser(page);
    const sinFoco: string[] = [];
    for (const [name, path] of screens()) {
      await open(page, path);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 1; i <= 6; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return { tag: "body", visible: false };
          const css = getComputedStyle(el);
          const outline = css.outlineStyle !== "none" && parseFloat(css.outlineWidth) > 0;
          const ring = css.boxShadow !== "none" && css.boxShadow !== "";
          const tag = `${el.tagName.toLowerCase()}[${
            el.getAttribute("aria-label") ||
            el.getAttribute("data-testid") ||
            (el.textContent ?? "").trim().slice(0, 30)
          }]`;
          return { tag, visible: outline || ring };
        });
        if (!info.visible) sinFoco.push(`${name} Tab ${i}: ${info.tag}`);
      }
    }
    expect.soft(sinFoco, `foco sin indicador:\n${sinFoco.join("\n")}`).toEqual([]);
  });
});

test.describe("con «reducir movimiento»", () => {
  test.use({ reducedMotion: "reduce" });

  test("ninguna animación corre en las pantallas principales", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsSecondUser(page);
    const corriendo: string[] = [];
    for (const [name, path] of screens()) {
      await open(page, path);
      await page.waitForTimeout(500);
      const found = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
            const kind =
              (a as CSSAnimation).animationName ??
              (a as CSSTransition).transitionProperty ??
              "waapi";
            return `${kind} en ${target?.tagName.toLowerCase() ?? "?"}${target?.getAttribute("data-testid") ? `[${target.getAttribute("data-testid")}]` : ""}`;
          }),
      );
      for (const f of found) corriendo.push(`${name}: ${f}`);
      // El sello no se estampa ni se marca como estampado
      await expect(page.locator("[data-estampado]"), `${name}: sello estampado`).toHaveCount(0);
    }
    expect(corriendo, corriendo.join("\n")).toEqual([]);
  });
});
