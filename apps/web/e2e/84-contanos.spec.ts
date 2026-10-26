import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_EMAIL, E2E_USER_ID, login, ownerDb } from "./helpers";
import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";

/**
 * Flujo 84 (C-23, V4): «Contanos qué pasó». Abrir el modal, elegir categoría, escribir y enviar;
 * mensaje de gracias; la fila aparece en `/settings/metricas` para el admin (test aparte, se
 * saltea si el usuario e2e no es admin en este entorno); axe con el modal abierto; Esc cierra; y todo a 390 px. El texto es inventado
 * y único por corrida; se borra al final.
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

test.describe("Flujo 84: Contanos qué pasó", () => {
  test("Esc cierra el modal y axe no encuentra violaciones graves con el modal abierto", async ({
    page,
  }) => {
    await login(page);
    await page.getByRole("button", { name: "Contanos qué pasó" }).click();
    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("No incluyas datos personales de otras personas ni datos sensibles tuyos."),
    ).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
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
    await page.getByRole("button", { name: "Contanos qué pasó" }).click();
    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    await dialog.getByRole("button", { name: "Enviar" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Elegí qué tipo de comentario es.");
    await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
    await dialog.getByRole("button", { name: "Enviar" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Escribí tu mensaje");
    await expect(dialog).toBeVisible();
  });

  test("envía el comentario, agradece, y el admin lo ve en métricas", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Ajustes" }).click();
    await page.waitForURL("**/settings");
    await page.getByRole("button", { name: "Contanos qué pasó" }).click();
    const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
    await dialog.getByRole("radio", { name: "Algo no anduvo" }).check();
    await dialog.getByLabel("Tu mensaje").fill(MENSAJE);
    await expect(dialog.getByTestId("message-counter")).toContainText(`/ 2000`);
    await dialog.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();
    await expect(dialog).toBeHidden();

    // Quedó guardado con la ruta (solo pathname) de donde estaba
    const { db, close } = ownerDb();
    const rows = await db
      .select()
      .from(s.betaFeedback)
      .where(eq(s.betaFeedback.userId, E2E_USER_ID));
    await close();
    const row = rows.find((r) => r.message === MENSAJE);
    expect(row?.category).toBe("algo_no_anduvo");
    expect(row?.path).toBe("/settings");
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
