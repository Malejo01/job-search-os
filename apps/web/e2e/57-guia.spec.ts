import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  cleanup,
  completeStep1,
  createInvitation,
  fillSkills,
  newRun,
  register,
  type Run,
} from "./personas/flow";
import type { PersonaKey } from "./personas/personas";

/**
 * Flujo 57 (ronda 92): la guía liviana. Un recorrido corto por pantalla (paso 1, skills, primeras
 * ofertas y /jobs) que se abre con «Ver guía», no bloquea la página y se recuerda con la cookie
 * `jso_guia` (el id del usuario como valor). Más los tres detalles de «Tu perfil»: contador del
 * resumen, alto del textarea y ayuda de CEFR. Con personas nuevas (`personas/flow.ts`), sin LLM ni
 * red; todo inventado. El caso 7 (la demo con el componente compartido) es el flujo 48, sin cambios.
 *
 * Cada test es independiente: crea su propia persona, llega a la pantalla que necesita con un
 * `goto` y la borra al terminar. Se pueden correr solos y en cualquier orden.
 */
test.describe.configure({ timeout: 120_000 });

const GUIDE_COOKIE = "jso_guia";

const guide = (page: Page) => page.getByTestId("guide");
const invite = (page: Page) => page.getByTestId("guide-invite");
/** El botón fijo. «Ver la guía» (el de la invitación) no coincide con `exact`. */
const opener = (page: Page) => page.getByRole("button", { name: "Ver guía", exact: true });
/** Elemento resaltado: el recorrido le pone un outline de 3 px. */
const anchor = (page: Page, name: string) => page.locator(`[data-tour="${name}"]`);

type Scene = { page: Page; run: Run; context: BrowserContext };

/**
 * Persona nueva hasta donde pide el test: `registro` queda en el paso 1, `perfil` en el paso 2
 * (skills) y `skills` en el paso 3 (primeras ofertas). La borra al terminar, pase lo que pase.
 */
async function withPersona(
  browser: Browser,
  upTo: "registro" | "perfil" | "skills",
  fn: (scene: Scene) => Promise<void>,
  options: { key?: PersonaKey } = {},
): Promise<void> {
  const run = newRun(options.key ?? "lucia");
  await createInvitation(run);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await register(page, run);
    if (upTo !== "registro") await completeStep1(page, run);
    if (upTo === "skills") await fillSkills(page, run);
    await fn({ page, run, context });
  } finally {
    await cleanup(run, context);
  }
}

/** Abre la guía con el botón; reintenta porque antes de hidratar el clic no hace nada. */
async function openGuide(page: Page): Promise<void> {
  await expect(async () => {
    await opener(page).click();
    await expect(guide(page)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

async function next(page: Page): Promise<void> {
  await guide(page).getByRole("button", { name: "Siguiente" }).click();
}

/** El borde inferior del elemento resaltado queda arriba del borde superior del panel (con reintento: el scroll es asíncrono). */
async function expectAnchorAbovePanel(page: Page, name: string): Promise<void> {
  await expect
    .poll(async () => {
      const a = await anchor(page, name).first().boundingBox();
      const p = await guide(page).boundingBox();
      return a !== null && p !== null && a.y + a.height <= p.y + 1;
    })
    .toBe(true);
}

test.describe("Flujo 57: guía del onboarding y de /jobs", () => {
  test("caso 1: en el paso 1 la invitación está visible y la guía cerrada; «Ver guía» recorre, vuelve y recuerda el paso", async ({
    browser,
  }) => {
    await withPersona(browser, "registro", async ({ page }) => {
      await page.goto("/onboarding");
      await expect(page.getByText("Paso 1 de 3")).toBeVisible();

      // Invitación visible, guía cerrada: no se abre sola
      await expect(invite(page)).toBeVisible();
      await expect(invite(page)).toContainText("¿Primera vez?");
      await expect(guide(page)).toBeHidden();
      await expect(opener(page)).toBeVisible();

      await openGuide(page);
      await expect(guide(page)).toContainText("Paso 1 de 6");
      await expect(guide(page)).toContainText("Qué buscás");
      await expect(anchor(page, "perfil:puestos")).toHaveCSS("outline-width", "3px");
      // Con la guía abierta la invitación sobra
      await expect(invite(page)).toHaveCount(0);

      await next(page);
      await expect(guide(page)).toContainText("Paso 2 de 6");
      await expect(guide(page)).toContainText("Dónde estás y tu inglés");
      await expect(anchor(page, "perfil:pais-ingles")).toHaveCSS("outline-width", "3px");
      await expect(anchor(page, "perfil:puestos")).toHaveCSS("outline-width", "0px");

      await guide(page).getByRole("button", { name: "Anterior" }).click();
      await expect(guide(page)).toContainText("Paso 1 de 6");
      // En el primer paso «Anterior» no hace nada
      await expect(guide(page).getByRole("button", { name: "Anterior" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );

      await next(page);
      await page.keyboard.press("Escape");
      await expect(guide(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();
      await expect(anchor(page, "perfil:pais-ingles")).toHaveCSS("outline-width", "0px");

      // Cerrar con Escape no pierde el paso, ni cuenta como rechazar la invitación
      await expect(invite(page)).toBeVisible();
      await openGuide(page);
      await expect(guide(page)).toContainText("Paso 2 de 6");
      await page.keyboard.press("Escape");
      await expect(guide(page)).toBeHidden();
    });
  });

  test("caso 2: «No, gracias» persiste al recargar, «Ver guía» sigue y otra cuenta del navegador ve la invitación", async ({
    browser,
  }) => {
    await withPersona(browser, "registro", async ({ page, context }) => {
      await page.goto("/onboarding");
      await expect(invite(page)).toBeVisible();
      // Antes de hidratar el clic no hace nada: se reintenta hasta que la invitación se va
      await expect(async () => {
        await invite(page).getByRole("button", { name: "No, gracias" }).click();
        await expect(invite(page)).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 10_000 });
      await expect(opener(page)).toBeFocused();

      // La cookie la fija la acción del servidor: se espera antes de recargar
      await expect
        .poll(async () => (await context.cookies()).find((c) => c.name === GUIDE_COOKIE)?.value)
        .toMatch(/^[0-9a-f-]{36}$/);

      await page.reload();
      await expect(page.getByText("Paso 1 de 3")).toBeVisible();
      await expect(invite(page)).toHaveCount(0);
      await expect(opener(page)).toBeVisible();

      // Misma cookie en el navegador, otra cuenta: la cookie lleva el id de quien la cerró
      const dismissed = (await context.cookies()).filter((c) => c.name === GUIDE_COOKIE);
      expect(dismissed, "la cookie quedó en el navegador").toHaveLength(1);
      // Otro contexto con solo esa cookie y otra cuenta (como en el flujo 38)
      const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await other.addCookies(dismissed);
        const run2 = newRun("valentina");
        await createInvitation(run2);
        try {
          const page2 = await other.newPage();
          await register(page2, run2);
          await expect(page2.getByText("Paso 1 de 3")).toBeVisible();
          await expect(invite(page2)).toBeVisible();
        } finally {
          await cleanup(run2, undefined);
        }
      } finally {
        await other.close();
      }
    });
  });

  test("caso 3: solo con teclado, un Tab por paso hasta el último, el foco nunca sale del panel", async ({
    browser,
  }) => {
    await withPersona(browser, "registro", async ({ page }) => {
      await page.goto("/onboarding");
      await expect(page.getByText("Paso 1 de 3")).toBeVisible();
      // Antes de hidratar el Enter no hace nada: se reintenta
      await expect(async () => {
        await opener(page).focus();
        await page.keyboard.press("Enter");
        await expect(guide(page)).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 10_000 });

      const inPanel = page.locator('[data-testid="guide"] :focus');
      for (let n = 1; n <= 5; n++) {
        await expect(guide(page)).toContainText(`Paso ${n} de 6`);
        // El foco está en «Siguiente»: Enter avanza sin ningún Tab
        await expect(guide(page).getByRole("button", { name: "Siguiente" })).toBeFocused();
        await page.keyboard.press("Enter");
      }

      // Último paso: «Siguiente» se reemplaza por «Listo» y el foco sigue dentro del panel
      await expect(guide(page)).toContainText("Paso 6 de 6");
      await expect(inPanel).toHaveCount(1);
      await expect(guide(page).getByRole("button", { name: "Listo" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(guide(page)).toBeHidden();
      await expect(opener(page)).toBeFocused();
      // Terminar cuenta como rechazar la invitación
      await expect(invite(page)).toHaveCount(0);

      // Terminar reinicia: al reabrir empieza en el paso 1
      await page.keyboard.press("Enter");
      await expect(guide(page)).toContainText("Paso 1 de 6");
      await page.keyboard.press("Escape");
    });
  });

  test("detalles de «Tu perfil»: el contador cambia de texto, el textarea arranca alto y la ayuda de CEFR es compacta a 360 px", async ({
    browser,
  }) => {
    await withPersona(browser, "registro", async ({ page }) => {
      await page.goto("/onboarding");
      const summary = page.getByLabel(/Resumen de tu perfil/);
      const counter = page.getByTestId("summary-counter");
      await expect(summary).toBeVisible();

      const label = (await page.locator('label[for="summary"]').textContent()) ?? "";
      const min = Number(/mínimo (\d+) caracteres/.exec(label)?.[1]);
      expect(min, "el rótulo dice el mínimo").toBeGreaterThan(0);
      const max = Number(/\/ (\d+)/.exec((await counter.textContent()) ?? "")?.[1]);
      expect(max, "el contador dice el máximo").toBeGreaterThan(min);

      await test.step("contador: cambia de texto cerca del mínimo y del máximo", async () => {
        await expect(counter).toContainText(`faltan ${min} para el mínimo`);
        await summary.fill("x".repeat(min - 1));
        await expect(counter).toContainText("faltan 1 para el mínimo");
        await summary.fill("x".repeat(min));
        await expect(counter).toContainText(`${min} / ${max}`);
        await expect(counter).not.toContainText("faltan");
        await expect(counter).not.toContainText("te quedan");
        await summary.fill("x".repeat(max - 10));
        await expect(counter).toContainText("te quedan 10");
        await summary.fill("x".repeat(max + 5));
        await expect(counter).toContainText("5 de más");
      });

      await test.step("textarea: arranca con varias líneas y no salta al escribir", async () => {
        await summary.fill("");
        const before = (await summary.boundingBox())!.height;
        expect(before).toBeGreaterThanOrEqual(200);
        await summary.fill("x".repeat(min));
        expect((await summary.boundingBox())!.height).toBe(before);
      });

      await test.step("CEFR a 360 px: no es demasiado alta ni genera scroll horizontal", async () => {
        await page.setViewportSize({ width: 360, height: 740 });
        const help = page.locator("details").filter({ hasText: "¿Qué es CEFR?" });
        await help.getByText("¿Qué es CEFR?").click();
        await expect(help).toHaveJSProperty("open", true);
        expect((await help.boundingBox())!.height).toBeLessThanOrEqual(320);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          360,
        );
      });
    });
  });

  test("caso 6: a 360 x 740 sin scroll horizontal y el elemento resaltado queda arriba del panel", async ({
    browser,
  }) => {
    await withPersona(browser, "registro", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto("/onboarding");
      await openGuide(page);

      // Resumen (paso 5): el bloque más alto que entra; Guardar (paso 6): el último de la página
      for (let n = 1; n < 5; n++) await next(page);
      await expect(guide(page)).toContainText("Paso 5 de 6");
      await expectAnchorAbovePanel(page, "perfil:resumen");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        360,
      );

      await next(page);
      await expect(guide(page)).toContainText("Paso 6 de 6");
      await expectAnchorAbovePanel(page, "perfil:guardar");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        360,
      );

      // Botones del panel de al menos 44 px
      for (const button of await guide(page).getByRole("button").all()) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });

  test("caso 4: no es modal, con la guía abierta se completa el formulario, un error no la cierra y se envía", async ({
    browser,
  }) => {
    await withPersona(browser, "registro", async ({ page, run }) => {
      await page.goto("/onboarding");
      await openGuide(page);
      await expect(guide(page)).toContainText("Paso 1 de 6");
      // El formulario sigue vivo debajo del panel: no hay ningún diálogo
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // Resumen corto: error junto al campo y la guía sigue abierta
      await page.getByLabel(/Tu nivel de inglés/).selectOption("B2");
      await page.getByLabel(/Años de experiencia/).fill("3");
      await page.getByLabel(/Resumen de tu perfil/).fill("corto");
      await page.getByRole("button", { name: "Guardar y continuar" }).click();
      // `p[role=alert]`: el anunciador de rutas de Next también es un `alert`
      await expect(page.locator('p[role="alert"]')).toContainText("al menos");
      await expect(guide(page)).toBeVisible();
      await expect(guide(page)).toContainText("Paso 1 de 6");

      // Lo cargado no se pierde, se completa lo que falta y se envía con la guía abierta
      await completeStep1(page, run);
      await expect(page).toHaveURL(/\/onboarding\/skills/);
    });
  });

  test("paso 2: la guía de skills tiene 4 pasos y «Saltear» queda arriba del panel", async ({
    browser,
  }) => {
    await withPersona(browser, "perfil", async ({ page }) => {
      await page.goto("/onboarding/skills");
      await expect(page.getByText("Paso 2 de 3")).toBeVisible();
      await expect(guide(page)).toBeHidden();
      await openGuide(page);
      await expect(guide(page)).toContainText("Paso 1 de 4");
      await expect(anchor(page, "skills:puestos")).toHaveCSS("outline-width", "3px");
      await next(page);
      await expect(guide(page)).toContainText("Tu nivel real");
      await expect(anchor(page, "skills:nivel")).toHaveCSS("outline-width", "3px");
      await next(page);
      await expect(guide(page)).toContainText("¿No está la tuya?");
      await next(page);
      await expect(guide(page)).toContainText("Paso 4 de 4");
      await expect(guide(page)).toContainText("Es opcional");
      // La barra de guardar es pegajosa abajo: con la guía abierta se corre para no quedar tapada
      await expectAnchorAbovePanel(page, "skills:saltear");
    });
  });

  test("paso 3: la guía de las primeras ofertas tiene 3 pasos", async ({ browser }) => {
    await withPersona(browser, "skills", async ({ page }) => {
      await page.goto("/onboarding/ofertas");
      await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();
      await openGuide(page);
      await expect(guide(page)).toContainText("Paso 1 de 3");
      await expect(anchor(page, "ofertas:lista")).toHaveCSS("outline-width", "3px");
      await next(page);
      await expect(guide(page)).toContainText("Tus alertas (opcional)");
      await expect(anchor(page, "ofertas:email")).toHaveCSS("outline-width", "3px");
      await next(page);
      await expect(guide(page)).toContainText("Paso 3 de 3");
      await expect(anchor(page, "ofertas:seguir")).toHaveCSS("outline-width", "3px");
    });
  });

  test("caso 5: /jobs sin ofertas saltea los pasos sin elemento y el total baja de 5", async ({
    browser,
  }) => {
    await withPersona(browser, "skills", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/jobs");
      await expect(page.getByTestId("first-steps")).toBeVisible();
      // Sin ofertas no hay tarjeta que resaltar (puntaje, etiquetas, opinión): esos pasos se saltean
      const cards = await anchor(page, "jobs:puntaje").count();
      await openGuide(page);

      const text = (await guide(page).textContent()) ?? "";
      const total = Number(/Paso 1 de (\d+)/.exec(text)?.[1]);
      expect(total).toBeGreaterThanOrEqual(2);
      expect(total).toBeLessThan(5);
      await expect(guide(page)).toContainText("Tus primeros pasos");
      await expect(anchor(page, "jobs:primeros-pasos")).toHaveCSS("outline-width", "3px");
      if (cards === 0) {
        expect(total).toBe(2);
        await expect(guide(page)).not.toContainText("El puntaje");
      }

      // El último paso es «Sin descripción»: a 1280 px, el link de la barra y no todo el header
      for (let n = 1; n < total; n++) await next(page);
      await expect(guide(page)).toContainText(`Paso ${total} de ${total}`);
      await expect(guide(page)).toContainText("Sin descripción");
      const link = page.locator('a[data-tour="jobs:menu"]').filter({ hasText: "Sin descripción" });
      await expect(link).toHaveCSS("outline-width", "3px");
      await expect(page.locator("header")).toHaveCSS("outline-width", "0px");
      await guide(page).getByRole("button", { name: "Listo" }).click();
      await expect(guide(page)).toBeHidden();
      await expect(link).toHaveCSS("outline-width", "0px");
    });
  });

  test("caso 5b: a 360 px el paso del menú resalta solo el botón «Menú», no todo el header", async ({
    browser,
  }) => {
    await withPersona(browser, "skills", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto("/jobs");
      await expect(page.getByTestId("first-steps")).toBeVisible();
      await openGuide(page);
      const total = Number(/Paso 1 de (\d+)/.exec((await guide(page).textContent()) ?? "")?.[1]);
      for (let n = 1; n < total; n++) await next(page);
      const menu = page.getByTestId("menu-movil").locator("summary");
      await expect(menu).toHaveCSS("outline-width", "3px");
      await expect(page.locator("header")).toHaveCSS("outline-width", "0px");
      await expect(page.getByTestId("menu-movil")).toHaveCSS("outline-width", "0px");
    });
  });
});
