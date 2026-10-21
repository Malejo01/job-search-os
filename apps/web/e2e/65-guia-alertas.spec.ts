import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import {
  closePrivacyDialog,
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 65: «Qué alertas crear» en Ajustes › Reenvío de emails. Usa a la persona B (sin mails ni
 * carrera por defecto) y la borra al terminar. Los links solo se miran: el test no los abre.
 */
test.describe("Flujo 65: guía de alertas por portal", () => {
  test.beforeAll(async () => {
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ targetRoles: ["ai_engineer"], targetRole: "ai_engineer", jobLanguages: ["es"] })
        .where(eq(s.profiles.userId, E2E_B_USER_ID));
      const body = JSON.stringify({
        event: { data: { subject: "Aviso ficticio e2e 65" } },
        content: { text: "hola", html: null },
      });
      const [blob] = await db
        .insert(s.rawBlobs)
        .values({
          userId: E2E_B_USER_ID,
          kind: "inbound_email",
          contentType: "application/json",
          body,
          bytes: body.length,
        })
        .returning({ id: s.rawBlobs.id });
      await db.insert(s.inboundEmails).values({
        userId: E2E_B_USER_ID,
        fromAddress: "Alertas <alertas@mail.getonbrd.com>",
        subject: "Aviso ficticio e2e 65",
        rawRef: `pg:${blob!.id}`,
        parser: "none",
        jobsExtracted: 0,
        error: null,
        receivedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      });
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    await removeSecondUser();
  });

  test("muestra las palabras de la carrera, el estado por portal y el link de LinkedIn", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/settings/asistente");
    await closePrivacyDialog(page);

    const guide = page.getByTestId("alert-guide");
    await expect(guide).toBeVisible();
    await expect(guide.getByTestId("alert-keyword").first()).toBeVisible();
    await expect(guide.getByTestId("alert-keyword").filter({ hasText: "python" })).toHaveCount(1);
    await expect(guide.getByTestId("alert-keyword").filter({ hasText: "chatbot" })).toHaveCount(1);
    await expect(guide.getByRole("button", { name: "Copiar “python”" })).toBeVisible();
    await expect(guide.getByRole("button", { name: "Copiar todas las palabras" })).toBeVisible();

    const gob = guide.getByTestId("alert-portal-getonboard");
    await expect(gob).toHaveAttribute("data-status", "activo");
    await expect(gob.getByTestId("alert-portal-getonboard-status")).toContainText("Activo");

    const linkedin = guide.getByTestId("alert-portal-linkedin");
    await expect(linkedin).toHaveAttribute("data-status", "nunca");
    await expect(linkedin.getByTestId("alert-portal-linkedin-status")).toContainText("Nunca");

    const link = guide.getByTestId("alert-portal-linkedin-link");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    expect(await link.getAttribute("href")).toMatch(
      /^https:\/\/www\.linkedin\.com\/jobs\/search\/\?keywords=/,
    );
    // Sin URL estable, no hay link
    await expect(guide.getByTestId("alert-portal-getonboard-link")).toHaveCount(0);
  });
});
