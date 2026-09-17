import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { E2E_EMAIL, E2E_PASSWORD, E2E_USER_ID, ownerDb } from "./helpers";

test.describe("setup inicial (JS-045/ADR-012)", () => {
  test("sin usuarios, /login manda a /setup y crear la cuenta loguea directo; después /setup se cierra", async ({
    page,
  }) => {
    const { db, close } = ownerDb();
    const [original] = await db.select().from(s.users).where(eq(s.users.id, E2E_USER_ID));
    try {
      await db.delete(s.users);

      await page.goto("/login");
      await page.waitForURL("**/setup");
      await expect(page.getByText("Todavía no hay ningún usuario.")).toBeVisible();
      await page.getByLabel("Email").fill(E2E_EMAIL);
      await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
      await page.getByLabel("Repetila").fill(E2E_PASSWORD);
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await page.waitForURL("**/jobs**");
      expect(page.url()).toContain("/jobs");

      // ya hay usuario: /setup queda cerrado. Sin cookies de sesión: logueado, /login
      // rebota a /jobs (auth.config.ts) y taparía el redirect propio de /setup.
      await page.context().clearCookies();
      await page.goto("/setup");
      await page.waitForURL("**/login");
    } finally {
      await db.delete(s.users);
      if (original) await db.insert(s.users).values(original);
      await close();
    }
  });
});
