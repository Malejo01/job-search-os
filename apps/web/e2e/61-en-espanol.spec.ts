import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_USER_ID,
  assignSeededPoolJobs,
  deleteSeededPublicJobs,
  login,
  ownerDb,
  seedPublicJobs,
} from "./helpers";

/**
 * Flujo 61 (ronda 101): el chip «En español» de /jobs y el conteo «Ofertas en español» del mercado.
 * Dos avisos ficticios en el pool, uno con lang `es` y otro `en`, asignados al usuario e2e por base.
 * Sin red. Si en la máquina no hay navegador de Playwright, corre en el CI.
 *
 * La carrera es propia de este spec: `/mercado/<carrera>` cachea 30 minutos, y si otro spec la
 * renderiza antes de sembrar (antes era `qa`), la línea «en español» no aparece. T6: el 34 también
 * la renderiza (al entrar a /hoy), pero ya con 2 avisos sembrados, y el 72 (persona B) corre después
 * por orden alfabético: el caché llega con avisos. Con otro orden de specs eso deja de valer.
 */
test.describe.configure({ mode: "serial" });

const CAREER = "ciberseguridad";

test.describe("Flujo 61: En español", () => {
  const tag = `es-${Date.now()}`;
  const esTitle = `Oferta Ficticia Español ${tag}`;
  const enTitle = `Oferta Ficticia Inglés ${tag}`;
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
        .set({ targetRole: CAREER, targetRoles: [CAREER] })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
    await seedPublicJobs(tag, [
      {
        title: esTitle,
        company: "Empresa Ficticia 10",
        sourceKind: "remoteok",
        roleHints: [CAREER],
        lang: "es",
      },
      {
        title: enTitle,
        company: "Empresa Ficticia 11",
        sourceKind: "remoteok",
        roleHints: [CAREER],
        lang: "en",
      },
    ]);
    await assignSeededPoolJobs(E2E_USER_ID, tag);
  });

  test.afterAll(async () => {
    await deleteSeededPublicJobs(tag);
    if (!original) return;
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ targetRole: original.targetRole, targetRoles: original.targetRoles })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
  });

  test("el chip deja solo las ofertas en español y se puede sacar", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=todas");
    await expect(page.getByText(esTitle)).toBeVisible();
    await expect(page.getByText(enTitle)).toBeVisible();

    const chip = page.getByTestId("chip-en-espanol");
    await expect(chip).not.toHaveAttribute("aria-current", "true");
    await chip.click();
    await expect(page).toHaveURL(/idioma=es/);
    await expect(page.getByText(esTitle)).toBeVisible();
    await expect(page.getByText(enTitle)).toHaveCount(0);
    await expect(page.getByTestId("chip-en-espanol")).toHaveAttribute("aria-current", "true");

    await page.getByTestId("chip-en-espanol").click();
    await expect(page).not.toHaveURL(/idioma=es/);
    await expect(page.getByText(enTitle)).toBeVisible();
  });

  test("el mercado público muestra el conteo de ofertas en español", async ({ page }) => {
    // El número puede venir del caché de 30 minutos: se verifica que la línea exista
    const res = await page.goto(`/mercado/${CAREER}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText(/Escritas en español: \d/)).toBeVisible();
  });
});
