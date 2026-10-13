import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_USER_ID,
  assignSeededPoolJobs,
  deleteSeededPublicJobs,
  login,
  ownerDb,
} from "./helpers";

/**
 * Flujo 35 (ronda 47): atribución de las fuentes nuevas. Dos avisos ficticios en el pool, uno de
 * We Work Remotely y otro de un ATS (Greenhouse) de «Empresa Ficticia 9», asignados al usuario e2e
 * por base. En el detalle de cada oferta se lee «Publicado en We Work Remotely» y «Publicado en el
 * sitio de empleos de Empresa Ficticia 9», con el link al aviso original. Sin red.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 35: atribución de WWR y de los ATS", () => {
  const tag = Date.now();
  const wwrTitle = `Oferta Ficticia WWR ${tag}`;
  const atsTitle = `Oferta Ficticia ATS ${tag}`;
  const urls = {
    wwr: `https://example.com/e2e-pool/${tag}/wwr`,
    ats: `https://example.com/e2e-pool/${tag}/ats`,
  };
  const jobIds: Record<"wwr" | "ats", string | undefined> = { wwr: undefined, ats: undefined };

  // Los puestos del usuario e2e los deja cada spec a su manera (32, 34): este los fija y los restaura
  let original: { targetRole: string | null; targetRoles: string[] } | null = null;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [profile] = await db
        .select({ targetRole: s.profiles.targetRole, targetRoles: s.profiles.targetRoles })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      if (!profile) throw new Error("el usuario e2e necesita perfil");
      original = profile;
      await db
        .update(s.profiles)
        .set({ targetRole: "qa", targetRoles: ["qa"] })
        .where(eq(s.profiles.userId, E2E_USER_ID));
      const now = new Date();
      const rows = [
        {
          key: "wwr",
          kind: "wwr",
          name: "WWR remote-programming-jobs",
          title: wwrTitle,
          company: "Empresa Ficticia 8",
        },
        {
          key: "ats",
          kind: "greenhouse",
          name: "Greenhouse empresa-ficticia-9",
          title: atsTitle,
          company: "Empresa Ficticia 9",
        },
      ] as const;
      for (const [i, r] of rows.entries()) {
        await db.insert(s.publicJobs).values({
          sourceKind: r.kind,
          // Mismo prefijo que usa la limpieza de helpers.ts
          externalId: `e2e-pool-${tag}-${i + 1}`,
          sourceName: r.name,
          sourceUrl: urls[r.key],
          canonicalUrl: urls[r.key],
          title: r.title,
          titleNormalized: r.title.toLowerCase(),
          companyRaw: r.company,
          companyNormalized: r.company.toLowerCase(),
          locationRaw: "Remoto (Anywhere in the World)",
          modality: "remoto",
          jdText: `Descripción ficticia del aviso ${i + 1} (${tag}): se busca una persona para un equipo remoto.`,
          jdHash: `e2e-pool-${tag}-${i + 1}`,
          roleHints: ["qa"],
          postedAt: now,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    } finally {
      await close();
    }
    await assignSeededPoolJobs(E2E_USER_ID, tag);
    const { db: db2, close: close2 } = ownerDb();
    try {
      const mine = await db2.select({ id: s.jobs.id, title: s.jobs.title }).from(s.jobs);
      jobIds.wwr = mine.find((j) => j.title === wwrTitle)?.id;
      jobIds.ats = mine.find((j) => j.title === atsTitle)?.id;
    } finally {
      await close2();
    }
  });

  test.afterAll(async () => {
    await deleteSeededPublicJobs(tag).catch(() => {});
    if (!original) return;
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ targetRole: original.targetRole, targetRoles: original.targetRoles })
        .where(eq(s.profiles.userId, E2E_USER_ID))
        .catch(() => {});
    } finally {
      await close();
    }
  });

  test("el aviso de WWR dice «Publicado en We Work Remotely» y enlaza al original", async ({
    page,
  }) => {
    expect(jobIds.wwr, "la asignación crea la oferta de WWR").toBeTruthy();
    await login(page);
    await page.goto(`/jobs/${jobIds.wwr}`);
    const origin = page.getByRole("list", { name: "Origen del aviso" });
    await expect(origin).toContainText("Publicado en We Work Remotely");
    const link = origin.getByRole("link", { name: /Ver el aviso original/ });
    await expect(link).toHaveAttribute("href", urls.wwr);
    expect(await link.getAttribute("rel")).not.toMatch(/nofollow/);
  });

  test("el aviso de un ATS nombra a la empresa y enlaza al original", async ({ page }) => {
    expect(jobIds.ats, "la asignación crea la oferta del ATS").toBeTruthy();
    await login(page);
    await page.goto(`/jobs/${jobIds.ats}`);
    const origin = page.getByRole("list", { name: "Origen del aviso" });
    await expect(origin).toContainText("Publicado en el sitio de empleos de Empresa Ficticia 9");
    await expect(origin.getByRole("link", { name: /Ver el aviso original/ })).toHaveAttribute(
      "href",
      urls.ats,
    );
  });
});
