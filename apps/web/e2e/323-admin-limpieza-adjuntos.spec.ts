import { expect, test } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  E2E_USER_ID,
  ensureSecondUser,
  login,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 323 (R29-09): limpieza de adjuntos de lo ya resuelto en `/admin/informes`. Datos inventados. Un ítem
 * resuelto hace 40 días, uno resuelto hace 2 días y uno visto de hace 90: el botón general confirma cuántos
 * archivos y MB va a borrar, borra solo el primero y deja «Adjunto borrado el …» en su lugar; «Borrar sus
 * adjuntos» borra el del ítem resuelto reciente; el visto no se toca nunca. El texto de los ítems se queda.
 */
test.describe.configure({ mode: "serial" });
test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const DAY = 86_400_000;

let reportId = "";
const items: Record<"viejo" | "reciente" | "visto", { itemId: string; attId: string }> = {
  viejo: { itemId: "", attId: "" },
  reciente: { itemId: "", attId: "" },
  visto: { itemId: "", attId: "" },
};

async function seed() {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.appAdmins).values({ userId: E2E_USER_ID }).onConflictDoNothing();
    const [r] = await db
      .insert(s.feedbackReports)
      .values({ userId: E2E_B_USER_ID, status: "visto", sentAt: new Date() })
      .returning({ id: s.feedbackReports.id });
    reportId = r!.id;
    const defs = [
      ["viejo", "resuelto", 40],
      ["reciente", "resuelto", 2],
      ["visto", "visto", 90],
    ] as const;
    let position = 0;
    for (const [key, status, age] of defs) {
      const [it] = await db
        .insert(s.feedbackItems)
        .values({
          reportId,
          userId: E2E_B_USER_ID,
          position: position++,
          path: "/hoy",
          category: "idea",
          message: `Texto del ítem ${key}`,
          status,
          statusChangedAt: new Date(Date.now() - age * DAY),
        })
        .returning({ id: s.feedbackItems.id });
      const sha = "e".repeat(64);
      const [blob] = await db
        .insert(s.blobFiles)
        .values({
          userId: E2E_B_USER_ID,
          contentType: "application/pdf",
          bytes: PDF.length,
          sha256: sha,
          data: PDF,
        })
        .returning({ id: s.blobFiles.id });
      const [att] = await db
        .insert(s.feedbackAttachments)
        .values({
          userId: E2E_B_USER_ID,
          itemId: it!.id,
          originalName: `${key}.pdf`,
          kind: "pdf",
          mime: "application/pdf",
          bytes: PDF.length,
          sha256: sha,
          blobRef: `pgb:${blob!.id}`,
        })
        .returning({ id: s.feedbackAttachments.id });
      items[key] = { itemId: it!.id, attId: att!.id };
    }
  } finally {
    await close();
  }
}

async function cleanAll() {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.feedbackReports)
      .where(inArray(s.feedbackReports.userId, [E2E_B_USER_ID, E2E_USER_ID]));
    await db.delete(s.blobFiles).where(inArray(s.blobFiles.userId, [E2E_B_USER_ID, E2E_USER_ID]));
  } finally {
    await close();
  }
}

async function attachmentState(id: string) {
  const { db, close } = ownerDb();
  try {
    const [a] = await db
      .select({ deletedAt: s.feedbackAttachments.deletedAt, ref: s.feedbackAttachments.blobRef })
      .from(s.feedbackAttachments)
      .where(eq(s.feedbackAttachments.id, id));
    return a!;
  } finally {
    await close();
  }
}

test.beforeAll(async () => {
  await ensureSecondUser();
  await cleanAll();
  await seed();
});
test.afterAll(async () => {
  await cleanAll();
  await removeSecondUser();
});

test("el botón general muestra cuántos archivos va a borrar y que no se puede deshacer", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/informes");
  const panel = page.getByTestId("purga-panel");
  await panel.getByText("Borrar adjuntos de lo resuelto ahora").click();
  const resumen = page.getByTestId("purga-resumen");
  await expect(resumen).toContainText("1 archivo");
  await expect(resumen).toContainText("30 días");
  await expect(resumen).toContainText("no se puede deshacer");
  // Nada se borró todavía
  expect((await attachmentState(items.viejo.attId)).deletedAt).toBeNull();
});

test("al confirmar borra solo lo resuelto hace 30 días o más; el texto y lo demás se quedan", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/informes");
  await page.getByTestId("purga-panel").getByText("Borrar adjuntos de lo resuelto ahora").click();
  await page.getByRole("button", { name: "Sí, borrar para siempre" }).click();
  await expect(page.getByTestId("purga-resumen")).toContainText("No hay adjuntos para borrar");

  expect((await attachmentState(items.viejo.attId)).deletedAt).not.toBeNull();
  expect((await attachmentState(items.viejo.attId)).ref).toBeNull();
  expect((await attachmentState(items.reciente.attId)).deletedAt).toBeNull();
  expect((await attachmentState(items.visto.attId)).deletedAt).toBeNull();

  await page.goto(`/admin/informes/${reportId}`);
  const viejo = page.getByTestId("informe-item").nth(0);
  await expect(viejo.getByTestId("informe-mensaje")).toContainText("Texto del ítem viejo");
  await expect(viejo.getByTestId("informe-borrados")).toContainText("Adjunto borrado el");
  await expect(viejo.getByTestId("informe-borrados")).toContainText("viejo.pdf");
  await expect(viejo.getByTestId("informe-documentos")).toHaveCount(0);
});

test("«Borrar sus adjuntos» borra los de un ítem resuelto y no aparece en uno visto", async ({
  page,
}) => {
  await login(page);
  await page.goto(`/admin/informes/${reportId}`);
  const visto = page.getByTestId("informe-item").nth(2);
  await expect(visto.getByTestId("informe-purga-item")).toHaveCount(0);

  const reciente = page.getByTestId("informe-item").nth(1);
  await reciente.getByText("Borrar sus adjuntos").click();
  await expect(reciente.getByTestId("informe-purga-item")).toContainText("no se puede deshacer");
  await reciente.getByRole("button", { name: "Sí, borrar para siempre" }).click();
  await expect(reciente.getByTestId("informe-borrados")).toContainText("reciente.pdf");
  expect((await attachmentState(items.reciente.attId)).deletedAt).not.toBeNull();
  expect((await attachmentState(items.visto.attId)).deletedAt).toBeNull();
});

test("el panel y los botones no están para una tester que no es admin", async ({ page }) => {
  const { loginAsSecondUser } = await import("./helpers");
  await loginAsSecondUser(page);
  const res = await page.goto("/admin/informes");
  expect(res?.status()).toBe(404);
});
