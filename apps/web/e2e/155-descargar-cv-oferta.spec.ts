import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Descargar el CV para esta oferta (R20-05). Persona B con datos inventados. La respuesta es el .docx
 * directo (nada se guarda), con nombre saneado, `no-store` y solo para la dueña de la sesión.
 */
let jobId: string;

test.describe("Descargar el CV para esta oferta", () => {
  test.beforeAll(async () => {
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      const [j] = await db
        .insert(s.jobs)
        .values({
          userId: E2E_B_USER_ID,
          companyRaw: "Empresa Ñandú A",
          title: "Analista de Datos (Remoto)",
          titleNormalized: "analista de datos",
          canonicalUrl: `https://example.com/e2e-descarga/${Date.now()}`,
          status: "evaluada",
          jdText: "JD ficticia.",
          flags: [],
          firstSeenAt: new Date(),
        })
        .returning({ id: s.jobs.id });
      jobId = j!.id;
      await db.insert(s.careerHistory).values({
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa A",
        title: "Analista",
        startMonth: "2022-01",
        bullets: ["Armé reportes mensuales", "Coordiné al equipo"],
      });
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_B_USER_ID));
    } finally {
      await close();
    }
    await removeSecondUser();
  });

  test("devuelve el .docx con nombre saneado y sin caché", async ({ page }) => {
    await loginAsSecondUser(page);
    const res = await page.request.get(`/jobs/${jobId}/postular/descargar`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toBe(
      'attachment; filename="CV-Analista-de-Datos-Remoto-Empresa-Nandu-A.docx"',
    );
    expect(res.headers()["content-type"]).toContain("wordprocessingml.document");
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.body();
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  test("sin sesión no descarga nada y un id inválido da 404", async ({ page, request }) => {
    // Sin sesión, el middleware redirige al ingreso antes de llegar a la ruta (307); la ruta sola da 401
    const anon = await request.get(`/jobs/${jobId}/postular/descargar`, { maxRedirects: 0 });
    expect([307, 401]).toContain(anon.status());
    expect(anon.headers()["content-disposition"] ?? "").not.toContain("attachment");
    await loginAsSecondUser(page);
    const bad = await page.request.get("/jobs/no-es-uuid/postular/descargar");
    expect(bad.status()).toBe(404);
    const other = await page.request.get(
      "/jobs/00000000-0000-4000-8000-000000000000/postular/descargar",
    );
    expect(other.status()).toBe(404);
  });

  test("la página ofrece el botón de descarga", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}/postular`);
    await expect(page.getByTestId("descargar-cv-oferta")).toHaveAttribute(
      "href",
      `/jobs/${jobId}/postular/descargar`,
    );
  });
});
