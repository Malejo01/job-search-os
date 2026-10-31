import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_EMAIL, E2E_USER_ID, login, ownerDb } from "./helpers";
import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";

/**
 * Flujo 84 (C-23, V4 / R1-9): «¿Algo no anduvo?» (chip de soporte). Abrir el modal desde el chip flotante,
 * elegir categoría, escribir y enviar; mensaje de gracias; la fila aparece en `/settings/metricas`
 * para el admin (test aparte, se saltea si el usuario e2e no es admin en este entorno); axe en claro y
 * oscuro con el modal abierto; Esc cierra; y todo a 390 px. Verifica que se persista el contexto.
 */
const MENSAJE = `Comentario ficticio de prueba ${Date.now()}`;
const e2eIsAdmin = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .includes(E2E_EMAIL.toLowerCase());

test.use({ viewport: { width: 390, height: 800 } });

test.afterAll(async () => {
  const { db, close } = ownerDb();
  await db.delete(s.betaFeedback).where(eq(s.betaFeedback.userId, E2E_USER_ID));
  await close();
});

test.describe("Flujo 84: Chip de soporte «¿Algo no anduvo?»", () => {
  test("Esc cierra el modal y axe no encuentra violaciones en claro ni oscuro", async ({
    page,
  }) => {
    await login(page);
    const chip = page.getByRole("button", { name: "¿Algo no anduvo?" });
    await expect(chip).toBeVisible();
    await chip.click();

    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("No incluyas datos personales de otras personas ni datos sensibles tuyos."),
    ).toBeVisible();

    // Axe en modo claro
    const { violations: violacionesClaro } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const gravesClaro = violacionesClaro.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      gravesClaro.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    ).toEqual([]);

    // Axe en modo oscuro
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    const { violations: violacionesOscuro } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const gravesOscuro = violacionesOscuro.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      gravesOscuro.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    ).toEqual([]);

    const { scrollWidth, ancho } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      ancho: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(ancho);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("sin categoría o sin mensaje no envía y avisa", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    await dialog.getByRole("button", { name: "Enviar" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Elegí qué tipo de comentario es.");
    await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
    await dialog.getByRole("button", { name: "Enviar" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Escribí tu mensaje");
    await expect(dialog).toBeVisible();
  });

  test("envía el comentario con contexto, agradece, y persiste en base", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Ajustes" }).click();
    await page.waitForURL("**/settings");
    await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    await dialog.getByRole("radio", { name: "Algo no anduvo" }).check();
    await dialog.getByLabel("Tu mensaje").fill(MENSAJE);
    await expect(dialog.getByTestId("message-counter")).toContainText(`/ 2000`);
    await dialog.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();
    await expect(dialog).toBeHidden();

    // Quedó guardado con la ruta y contexto
    const { db, close } = ownerDb();
    const rows = await db
      .select()
      .from(s.betaFeedback)
      .where(eq(s.betaFeedback.userId, E2E_USER_ID));
    await close();
    const row = rows.find((r) => r.message === MENSAJE);
    expect(row?.category).toBe("algo_no_anduvo");
    expect(row?.path).toBe("/settings");
    expect(row?.context).toBeDefined();
    expect(row?.context?.pathname).toBe("/settings");
    expect(Array.isArray(row?.context?.actions)).toBe(true);
    expect(row?.context?.actions?.length).toBeGreaterThan(0);
    expect(
      row?.context?.actions?.some(
        (a) => a.text.includes("Ajustes") || a.text.includes("¿Algo no anduvo?"),
      ),
    ).toBe(true);
  });

  test("el admin ve el comentario en /settings/metricas, sin email", async ({ page }) => {
    test.skip(
      !e2eIsAdmin,
      "El usuario e2e no es admin en este entorno (ADMIN_EMAILS sin E2E_EMAIL)",
    );
    const mensaje = `Comentario ficticio para el admin ${Date.now()}`;
    const { db, close } = ownerDb();
    await db.insert(s.betaFeedback).values({
      userId: E2E_USER_ID,
      category: "algo_no_anduvo",
      message: mensaje,
      path: "/settings",
      context: {
        pathname: "/settings",
        pageTitle: "Ajustes",
        theme: "light",
        actions: [{ type: "click", text: "Ajustes", time: new Date().toISOString() }],
      },
    });
    await close();
    await login(page);
    await page.goto("/settings/metricas");
    const section = page.getByRole("heading", { name: "Lo que nos contaron" }).locator("..");
    await expect(section.getByText(mensaje)).toBeVisible();
    await expect(section.getByText("Algo no anduvo").first()).toBeVisible();
    await expect(section.getByText("/settings", { exact: true }).first()).toBeVisible();
    // Sin email del autor: solo el identificador seudónimo
    await expect(section).not.toContainText("@");
  });
});
