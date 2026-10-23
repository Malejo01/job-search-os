import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  E2E_USER_ID,
  deleteJob,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedTargetRoles,
  setSeedTargetRoles,
} from "./helpers";

/**
 * Flujo 72 (C-6, E2): «Tu encaje». Todo inventado.
 *
 * - A es el usuario seed y B la persona nueva de los helpers. A tiene 6 ofertas cuyo checklist
 *   falla en «Sueldo»; B tiene primero 3 y después 6 ofertas que fallan en «Inglés».
 * - «Tu encaje» se cachea 15 minutos por persona y carrera. Para no depender del orden, cada caso
 *   de B usa una carrera distinta que nadie visitó antes (la base chica y el freno).
 * - B se sirve de dos carreras que ningún otro spec elige para B; A usa una tercera para «Hoy».
 */
test.describe.configure({ mode: "serial" });

const ROLE_SMALL = "ciberseguridad";
const ROLE_FRENO = "rrhh_it";
const ROLE_A = "marketing_digital";

type Status = "cumple" | "no_cumple" | "no_se_sabe";

/** Un `evaluations.decision.checklist` con la forma que valida `parseChecklist`. */
function checklistWith(failing: "ingles" | "salario") {
  const item = (id: "ingles" | "salario", pide: string) => {
    const status: Status = id === failing ? "no_cumple" : "cumple";
    return {
      id,
      kind: "estructurado",
      nivel: "must",
      pide,
      evidencia: null,
      tenes: null,
      status,
      fuente: { pide: "fuente", tenes: "perfil" },
      bloquea: false,
    };
  };
  const items = [item("ingles", "Inglés fluido"), item("salario", "Sueldo en dólares")];
  return {
    items,
    must: { cumple: 1, no_cumple: 1, no_se_sabe: 0 },
    deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
    parcial: false,
    // Como en el evaluador: el primer must que no se cumple (E4b lo cruza con «Tu encaje»)
    descarte_rapido: items.find((it) => it.status === "no_cumple") ?? null,
  };
}

/** Siembra `count` ofertas evaluadas de la persona con ese checklist; devuelve los ids. */
async function seedOffers(
  userId: string,
  tag: number,
  start: number,
  count: number,
  failing: "ingles" | "salario",
): Promise<string[]> {
  const { db, close } = ownerDb();
  try {
    const ids: string[] = [];
    for (let i = start; i < start + count; i++) {
      const title = `Oferta Ficticia Encaje ${tag} ${i}`;
      const [job] = await db
        .insert(s.jobs)
        .values({
          userId,
          companyRaw: `Empresa Encaje ${tag} ${i}`,
          title,
          titleNormalized: title.toLowerCase(),
          canonicalUrl: `https://example.com/e2e-encaje/${tag}/${userId}/${i}`,
          locationRaw: "Remoto (Brasil)",
          modality: "remoto",
          status: "evaluada",
          jdText: `Descripción ficticia ${i} (${tag}).`,
          flags: [],
          firstSeenAt: new Date(),
        })
        .returning({ id: s.jobs.id });
      await db.insert(s.evaluations).values({
        jobId: job!.id,
        userId,
        criteriaVersion: 1,
        promptVersion: "evaluate_job@e2e",
        model: "fake",
        hadFullJd: true,
        score: 6,
        locationOk: "ok",
        modality: "remoto",
        discipline: "ai_engineer",
        matchFuerte: [],
        gaps: [],
        bloqueadoresDuros: [],
        senalesPositivas: [],
        veredicto: "Evaluación de prueba (e2e).",
        accion: "guardar",
        decision: { checklist: checklistWith(failing) },
      });
      ids.push(job!.id);
    }
    return ids;
  } finally {
    await close();
  }
}

async function setRolesOf(userId: string, roles: string[]): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.profiles)
      .set({ targetRoles: roles, targetRole: roles[0] ?? null })
      .where(eq(s.profiles.userId, userId));
  } finally {
    await close();
  }
}

/** Resumen de violaciones de axe: regla, impacto y selectores; nunca el HTML. */
async function axeSummary(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

test.describe("Flujo 72: Tu encaje", () => {
  const tag = Date.now();
  const jobIds: string[] = [];
  const bJobIds: string[] = [];
  let originalRoles: Awaited<ReturnType<typeof seedTargetRoles>>;

  test.beforeAll(async () => {
    originalRoles = await seedTargetRoles();
    await setSeedTargetRoles({ targetRoles: [ROLE_A], targetRole: ROLE_A });
    jobIds.push(...(await seedOffers(E2E_USER_ID, tag, 1, 6, "salario")));
    await ensureSecondUser();
    await setRolesOf(E2E_B_USER_ID, [ROLE_SMALL, ROLE_FRENO]);
  });

  test.afterAll(async () => {
    for (const id of jobIds) await deleteJob(id).catch(() => {});
    await removeSecondUser().catch(() => {});
    await setSeedTargetRoles(originalRoles).catch(() => {});
  });

  test("con menos de 5 ofertas: titular de base chica y sin rankings", async ({ page }) => {
    await seedOffers(E2E_B_USER_ID, tag, 1, 3, "ingles");
    await loginAsSecondUser(page);
    await page.goto(`/encaje?rol=${ROLE_SMALL}`);
    await expect(page.getByRole("heading", { level: 1, name: "Tu encaje" })).toBeVisible();
    await expect(page.getByTestId("encaje-frase")).toContainText(
      "Todavía tenés pocas ofertas evaluadas",
    );
    await expect(page.getByTestId("encaje-vacio-base-chica")).toBeVisible();
    await expect(page.getByTestId("encaje-frenos")).toHaveCount(0);
    // El mercado de la carrera se muestra igual (con o sin ofertas públicas)
    await expect(page.getByTestId("encaje-mercado")).toBeVisible();
  });

  test("con 6 ofertas: «Lo que más te frena» dice «N de M» y la página no usa jerga", async ({
    page,
  }) => {
    bJobIds.push(...(await seedOffers(E2E_B_USER_ID, tag, 4, 3, "ingles")));
    await loginAsSecondUser(page);
    await page.goto(`/encaje?rol=${ROLE_FRENO}`);
    const frenos = page.getByTestId("encaje-frenos");
    await expect(frenos).toBeVisible();
    await expect(frenos.getByRole("heading", { level: 2 })).toHaveText("Lo que más te frena");
    await expect(page.getByTestId("encaje-freno-ingles")).toContainText(
      "no se cumple en 6 de 6 ofertas",
    );
    await expect(page.getByTestId("encaje-frase")).toContainText(
      "Lo que más te frena es «Inglés»: aparece en 6 de 6 ofertas",
    );
    await expect(page.getByTestId("encaje-base")).toContainText("6 ofertas evaluadas");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const jargon of ["score", "ponderad"]) {
      expect(text, `la página dice «${jargon}»`).not.toContain(jargon);
    }
    // Cada bloque es una región con su propio título
    for (const section of await page.locator('section[data-testid^="encaje-"]').all()) {
      await expect(section.getByRole("heading", { level: 2 })).toHaveCount(1);
    }
  });

  test("B no ve los datos de A (RLS): sus frenos son los suyos", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/encaje?rol=${ROLE_FRENO}`);
    await expect(page.getByTestId("encaje-freno-ingles")).toBeVisible();
    // A tiene 6 ofertas que fallan en «Sueldo»: B no puede verlas ni contarlas
    await expect(page.getByTestId("encaje-freno-salario")).toHaveCount(0);
    await expect(page.getByTestId("encaje-frenos")).not.toContainText("Sueldo");
    await expect(page.getByTestId("encaje-base")).toContainText("6 ofertas evaluadas");
    const html = await page.content();
    expect(html, "aparece una oferta de A").not.toContain(`Oferta Ficticia Encaje ${tag} 1`);
  });

  test("E4b: el detalle de una oferta cruza su descarte con el freno más común", async ({
    page,
  }) => {
    // La línea usa la carrera principal: rrhh_it, cuyo cálculo (con las 6 ofertas) ya está en caché
    await setRolesOf(E2E_B_USER_ID, [ROLE_FRENO, ROLE_SMALL]);
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${bJobIds[0]}`);
    const cross = page.getByTestId("encaje-cruce");
    await expect(cross).toContainText("Esto mismo te pasa en 6 de tus 6 ofertas.");
    await expect(cross.getByRole("link", { name: "Ver Tu encaje" })).toHaveAttribute(
      "href",
      "/encaje",
    );
  });

  test("la tarjeta «Tu encaje» de «Hoy» lleva a /encaje", async ({ page }) => {
    await login(page);
    const card = page.getByTestId("hoy-encaje");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Tu encaje" })).toBeVisible();
    await card.getByRole("link", { name: "Ver tu encaje" }).click();
    await expect(page).toHaveURL(/\/encaje$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tu encaje" })).toBeVisible();
    await expect(page.getByTestId("encaje-frase")).toBeVisible();
  });

  test("/market y /plan enlazan a /encaje", async ({ page }) => {
    await login(page);
    await page.goto("/market");
    await expect(page.getByRole("link", { name: "Explicado en llano: Tu encaje" })).toHaveAttribute(
      "href",
      /^\/encaje/,
    );
    await page.goto("/plan");
    await expect(page.getByRole("link", { name: /^Ver Tu encaje/ })).toHaveAttribute(
      "href",
      "/encaje",
    );
  });

  for (const viewport of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    test(`a ${viewport.width} px no hay scroll horizontal y axe no encuentra violaciones`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await loginAsSecondUser(page);
      await page.goto(`/encaje?rol=${ROLE_FRENO}`);
      await expect(page.getByTestId("encaje-frenos")).toBeVisible();
      if (viewport.width === 360) {
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width, "scrollWidth en /encaje").toBeLessThanOrEqual(360);
      }
      expect(
        await axeSummary(page),
        `Violaciones de axe en /encaje a ${viewport.width} px`,
      ).toEqual([]);
    });
  }
});
