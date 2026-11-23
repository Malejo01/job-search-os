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
 * Preparar mi postulación, bloque «Tu CV frente a esta oferta» (R20-03). Usa a la persona B, con datos
 * inventados: la base local no tiene el CV del usuario del seed. Sin modelo: todo sale de código.
 */
let conCv: string;
let sinCv: string;
let nameA = "";
let nameB = "";

test.describe("Tu CV frente a esta oferta", () => {
  test.beforeAll(async () => {
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      const sk = await db.select({ id: s.skills.id, name: s.skills.name }).from(s.skills).limit(2);
      expect(sk.length).toBe(2);
      nameA = sk[0]!.name;
      nameB = sk[1]!.name;
      const mk = async (title: string) => {
        const [j] = await db
          .insert(s.jobs)
          .values({
            userId: E2E_B_USER_ID,
            companyRaw: "Empresa A",
            title,
            titleNormalized: title.toLowerCase(),
            canonicalUrl: `https://example.com/e2e-cv/${Date.now()}-${title.length}`,
            status: "evaluada",
            jdText: "JD ficticia.",
            flags: [],
            firstSeenAt: new Date(),
          })
          .returning({ id: s.jobs.id });
        return j!.id;
      };
      sinCv = await mk("Oferta ficticia sin CV");
      conCv = await mk("Oferta ficticia con CV");
      await db.insert(s.jobSkills).values([
        { jobId: sinCv, skillId: sk[0]!.id, isMust: true },
        { jobId: conCv, skillId: sk[0]!.id, isMust: true },
        { jobId: conCv, skillId: sk[1]!.id, isMust: false },
      ]);
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

  test("sin CV confirmado muestra un estado vacío claro", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${sinCv}/postular`);
    await expect(page.getByTestId("postular-cv-oferta")).toBeVisible();
    await expect(page.getByTestId("cv-oferta-vacio")).toBeVisible();
  });

  test("con CV, muestra lo pedido, lo que falta y las viñetas ordenadas sin reescribirlas", async ({
    page,
  }) => {
    const { db, close } = ownerDb();
    const first = "Armé reportes mensuales para el equipo";
    const second = `Trabajé con ${nameA} todos los días`;
    try {
      await db.insert(s.careerHistory).values({
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa A",
        title: "Analista",
        startMonth: "2022-01",
        bullets: [first, second],
      });
    } finally {
      await close();
    }
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${conCv}/postular`);
    const pedidas = page.getByTestId("cv-oferta-pedidas");
    await expect(pedidas).toContainText(nameA);
    await expect(pedidas).toContainText(nameB);
    await expect(page.getByTestId("cv-oferta-faltan")).toContainText(nameB);
    const vinietas = page.getByTestId("cv-oferta-vinietas").getByRole("listitem");
    await expect(vinietas).toHaveCount(1);
    await expect(vinietas.first()).toContainText(second);
  });
});
