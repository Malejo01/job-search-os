import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { E2E_EMAIL, E2E_PASSWORD, E2E_USER_ID, ownerDb } from "./helpers";

async function termsOf(): Promise<{ version: string | null; acceptedAt: Date | null }> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ version: s.users.termsVersion, acceptedAt: s.users.termsAcceptedAt })
      .from(s.users)
      .where(eq(s.users.id, E2E_USER_ID));
    return row!;
  } finally {
    await close();
  }
}

async function setTerms(version: string | null, acceptedAt: Date | null): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.users)
      .set({ termsVersion: version, termsAcceptedAt: acceptedAt })
      .where(eq(s.users.id, E2E_USER_ID));
  } finally {
    await close();
  }
}

test.describe("re-aceptación de los términos (ronda 83)", () => {
  test("con una versión vieja redirige, exige la casilla y al aceptar vuelve a /jobs", async ({
    page,
  }) => {
    const original = await termsOf();
    try {
      await setTerms("2000-01-01", new Date("2000-01-01T00:00:00Z"));

      // login sin el helper: ahí el destino es la pantalla de términos, no /jobs
      await page.goto("/login");
      await page.getByLabel("Email").fill(E2E_EMAIL);
      await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("**/terminos-actualizados");
      await expect(
        page.getByRole("heading", {
          name: "Actualizamos los términos y la política de privacidad",
        }),
      ).toBeVisible();

      // el gate cubre toda la app
      await page.goto("/jobs");
      await page.waitForURL("**/terminos-actualizados");

      // sin la casilla: error junto al campo y la base no cambia
      await page.getByRole("button", { name: "Aceptar y seguir" }).click();
      const checkbox = page.getByLabel("Leí y acepto los términos y la política de privacidad");
      await expect(
        page.getByRole("alert").filter({ hasText: "aceptar los términos" }),
      ).toBeVisible();
      await expect(checkbox).toHaveAttribute("aria-invalid", "true");
      expect((await termsOf()).version).toBe("2000-01-01");

      // con la casilla: vuelve a /jobs y queda la versión vigente
      await checkbox.check();
      await page.getByRole("button", { name: "Aceptar y seguir" }).click();
      await page.waitForURL("**/jobs**");
      const after = await termsOf();
      expect(after.version).toBe(TERMS_VERSION);
      expect(after.acceptedAt!.getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);

      // ya al día: la pantalla manda a /jobs
      await page.goto("/terminos-actualizados");
      await page.waitForURL("**/jobs**");
    } finally {
      await setTerms(original.version, original.acceptedAt);
    }
  });
});
