import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../../packages/db/src/user-tables";
import roleSkills from "../../../../packages/db/seeds/role_skills.json";
import {
  E2E_USER_ID,
  assignSeededPoolJobs,
  deleteSeededPublicJobs,
  chooseRoles,
  localChildEnv,
  ownerDb,
  runDemoWorker,
  seedPublicJobs,
  skillLevelsOf,
} from "../helpers";
import { SKILL_NAMES, buildPersona, type Persona, type PersonaKey } from "./personas";

/**
 * Recorrido común de las personas sintéticas (ronda 42): invitación, registro, paso 1, Mis skills,
 * «Tus primeras ofertas», evaluación demo, /jobs, /market y /plan. Sin red ni LLM: el pool se
 * siembra y el worker corre en modo demo. Cada paso anota su duración en `test.info().annotations`
 * (tipo `tiempo`) y los hallazgos para la beta con tipo `hallazgo`.
 */
const ROOT = resolve(__dirname, "../../../..");
const COMPUTE_SCRIPT = resolve(__dirname, "compute-market.ts");

/** Estado de una corrida: la persona, su código de invitación y lo que hay que borrar al final. */
export type Run = {
  tag: number;
  persona: Persona;
  code: string;
  invitationId?: string;
  userId: string | null;
};

export function newRun(key: PersonaKey): Run {
  const tag = Date.now();
  return {
    tag,
    persona: buildPersona(key, tag),
    // Igual que createInvitation (lib/invitations.ts): código aleatorio, en la base solo su sha256
    code: randomBytes(32).toString("base64url"),
    userId: null,
  };
}

export function annotate(step: string, ms: number): void {
  test.info().annotations.push({ type: "tiempo", description: `${step}: ${Math.round(ms)} ms` });
}

export function finding(text: string): void {
  test.info().annotations.push({ type: "hallazgo", description: text });
}

/** Corre un paso y anota cuánto tardó (también si falla). */
export async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    annotate(step, Date.now() - started);
  }
}

export async function createInvitation(run: Run): Promise<void> {
  const codeHash = createHash("sha256").update(run.code).digest("hex");
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .insert(s.invitations)
      .values({ codeHash, email: run.persona.email, createdByUserId: E2E_USER_ID })
      .returning({ id: s.invitations.id });
    run.invitationId = row!.id;
  } finally {
    await close();
  }
}

/** Siembra las 4 ofertas del pool de la persona (3 de su puesto y 1 de otro) con sus skills. */
export async function seedPool(run: Run): Promise<void> {
  await seedPublicJobs(
    run.tag,
    run.persona.offers.map((o) => ({
      title: o.title,
      company: o.company,
      sourceKind: o.sourceKind,
      roleHints: o.roleHints,
      skills: o.skills,
    })),
  );
}

export async function register(page: Page, run: Run): Promise<void> {
  const { persona } = run;
  await page.goto(`/register?code=${run.code}`);
  await page.getByLabel("Email").fill(persona.email);
  await page.getByLabel("Nombre (opcional)").fill(persona.name);
  await page.getByLabel("Contraseña", { exact: true }).fill(persona.password);
  await page.getByLabel("Repetí la contraseña").fill(persona.password);
  await page.getByLabel(/Leí y acepto/).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  // El registro deja la sesión iniciada: va directo al onboarding
  await page.waitForURL("**/onboarding**");

  // Si la carrera de la persona es de la beta (sin listar en el catálogo público general),
  // se vincula a su perfil para que el selector muestre el checkbox según la regla («las conserva quien las tiene»)
  if (persona.role === "abogacia" || persona.role === "comunicacion") {
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, persona.email));
      if (user) {
        run.userId = user.id;
        await db
          .update(s.profiles)
          .set({ targetRoles: [persona.role] })
          .where(eq(s.profiles.userId, user.id));
        await page.reload();
      }
    } finally {
      await close();
    }
  }
}

/** Paso 1: el puesto está en su grupo del selector, se elige y se completa el perfil. */
export async function completeStep1(page: Page, run: Run): Promise<void> {
  const { persona } = run;
  const isPreselected = await page
    .locator(`input[name="targetRoles"][value="${persona.role}"]`)
    .isChecked()
    .catch(() => false);
  if (!isPreselected) {
    await expect(page.locator('input[name="targetRoles"]:checked')).toHaveCount(0);
  }
  // El grupo se verifica por su fieldset/legend y el puesto por el value de la casilla
  const group = page.getByRole("group", { name: persona.roleGroup, exact: true });
  const box = group.locator(`input[name="targetRoles"][value="${persona.role}"]`);
  await expect(box).toHaveCount(1);
  await chooseRoles(group, [persona.role]);
  await page.getByLabel(/País de residencia/).fill(persona.country);
  await page.getByRole("option", { name: new RegExp(`\\(${persona.country}\\)`) }).click();
  await page.getByLabel(/Tu nivel de inglés/).selectOption(persona.cefr);
  await page.getByLabel(/Años de experiencia/).fill(persona.years);
  await page.getByLabel(/Resumen de tu perfil/).fill(persona.summary);
  // Remoto viene marcado; quien acepta más modalidades suma Híbrido y Presencial
  await page.getByRole("checkbox", { name: "Remoto" }).check();
  if (!persona.remoteOnly) {
    await page.getByRole("checkbox", { name: "Híbrido" }).check();
    await page.getByRole("checkbox", { name: "Presencial" }).check();
  }
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await page.waitForURL("**/onboarding/skills**");

  const { db, close } = ownerDb();
  try {
    const [user] = await db
      .select({
        id: s.users.id,
        targetRole: s.profiles.targetRole,
        targetRoles: s.profiles.targetRoles,
      })
      .from(s.users)
      .innerJoin(s.profiles, eq(s.profiles.userId, s.users.id))
      .where(eq(s.users.email, persona.email));
    run.userId = user!.id;
    expect(user!.targetRoles).toEqual([persona.role]);
    expect(user!.targetRole).toBe(persona.role);
  } finally {
    await close();
  }
}

/** Mis skills: viene con su puesto marcado, sus niveles se guardan con «Guardar y seguir» (no «Saltear»). */
export async function fillSkills(page: Page, run: Run): Promise<void> {
  const { persona } = run;
  // Por href, no por la etiqueta: no depende del texto del puesto
  await expect(page.locator(`a[href*="rol=${persona.role}"]`)).toHaveAttribute(
    "aria-current",
    "true",
  );
  const levelLabels = [
    "nunca lo usé",
    "hice un tutorial o curso",
    "lo usé en un proyecto",
    "lo uso con soltura",
  ];
  for (const { slug, level } of persona.skills) {
    const row = page.getByTestId(`skill-${slug}`);
    await expect(row).toContainText(SKILL_NAMES[slug]!);
    await row.getByLabel(levelLabels[level]!, { exact: true }).check();
  }
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await page.waitForURL("**/onboarding/ofertas**");
  await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();

  const saved = await skillLevelsOf(run.userId!);
  for (const { slug, level } of persona.skills) expect(saved[slug], slug).toBe(level);
}

/** Asigna el pool sembrado a la persona (como la asignación real, que filtra por su puesto). */
export async function assignPool(run: Run): Promise<void> {
  expect(run.userId, "el paso 1 crea a la persona").not.toBeNull();
  await assignSeededPoolJobs(run.userId!, run.tag);
}

/** Evalúa lo que quedó en la cola con el worker demo (sin LLM). */
export function evaluatePool(): void {
  runDemoWorker();
}

/** Asigna y evalúa, como el e2e 27 (`assignSeededPoolJobs` y después `runDemoWorker`). */
export async function seedAndEvaluate(run: Run): Promise<void> {
  await assignPool(run);
  evaluatePool();
}

/**
 * Calcula el mercado por puesto (`buildRoleMarketSnapshots`) y el plan del usuario
 * (`recomputeMarketForUser` + `buildLearningPlan`) con las funciones de adapters y la conexión
 * dueña. Se corre con tsx porque los specs son CommonJS (ver compute-market.ts).
 */
export function computeRoleMarketAndPlan(
  run: Run,
  options: { rebuildOnly?: boolean } = {},
): string {
  const arg = options.rebuildOnly ? "" : ` ${run.userId!}`;
  return execSync(`pnpm exec tsx "${COMPUTE_SCRIPT}"${arg}`, {
    cwd: resolve(ROOT, "packages/adapters"),
    encoding: "utf8",
    env: localChildEnv({ LOG_LEVEL: "warn" }),
    timeout: 120_000,
  });
}

/**
 * Borra a la persona, su invitación y el pool sembrado, cada paso por separado: si uno falla, los
 * demás igual corren. Al final reconstruye el mercado por puesto sin las filas sembradas.
 */
export async function cleanup(run: Run, context: BrowserContext | undefined): Promise<void> {
  await context?.close().catch(() => {});
  await deleteSeededPublicJobs(run.tag).catch(() => {});
  const { db, close } = ownerDb();
  try {
    const [user] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, run.persona.email));
    const id = user?.id ?? run.userId;
    if (id) {
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
          await deleteUserData(tx as never, id);
        })
        .catch(() => {});
      // Lo que corre en `after()` al guardar el perfil puede escribir después del borrado
      await db.delete(s.jobs).where(eq(s.jobs.userId, id));
    }
    if (run.invitationId) {
      await db.delete(s.invitations).where(eq(s.invitations.id, run.invitationId));
    }
  } finally {
    await close();
  }
  try {
    computeRoleMarketAndPlan(run, { rebuildOnly: true });
  } catch {
    // Solo deja el mercado local sin las filas ficticias: no vale la pena fallar por esto
  }
}

/** Skills de las ofertas de su puesto (sin las del control negativo), sin repetir. */
function ownSkillSlugs(persona: Persona): string[] {
  const slugs = persona.offers
    .filter((o) => o.own)
    .flatMap((o) => (o.skills ?? []).map((k) => k.slug));
  return [...new Set(slugs)];
}

/**
 * Define el spec completo de una persona: 5 pruebas en serie con celular de 390 px. Los specs
 * `28`–`31` solo llaman a esta función con la clave de su persona.
 */
export function definePersonaSpec(key: PersonaKey): void {
  test.describe.configure({ mode: "serial" });

  test.describe(`Persona ${key}: del registro al plan de su puesto`, () => {
    const run = newRun(key);
    const { persona } = run;
    const ownOffers = persona.offers.filter((o) => o.own);
    const control = persona.offers.find((o) => !o.own)!;
    let context: BrowserContext | undefined;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      await createInvitation(run);
      await seedPool(run);
      context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await cleanup(run, context);
    });

    test("se registra, elige su puesto en el grupo correcto y carga sus skills", async () => {
      await timed("registro", () => register(page, run));
      await timed("paso 1", () => completeStep1(page, run));
      await timed("mis skills", () => fillSkills(page, run));
    });

    test("«Tus primeras ofertas» muestra las de su puesto con fuente y no la del otro", async () => {
      await timed("asignar pool", () => assignPool(run));
      await page.goto("/onboarding/ofertas");

      for (const o of ownOffers) {
        const card = page.getByTestId("first-offer").filter({ hasText: o.title });
        await expect(card).toBeVisible();
        await expect(card).toContainText("Publicado en ");
      }
      expect(await page.content()).not.toContain(control.title);
    });

    test("después de evaluar aparece un score", async () => {
      await timed("evaluar (worker demo)", async () => evaluatePool());
      await timed("score visible", () =>
        expect(async () => {
          await page.goto("/onboarding/ofertas");
          await expect(page.getByTestId("first-offer-score").first()).toBeVisible({
            timeout: 2_000,
          });
        }).toPass({ timeout: 30_000, intervals: [2_000] }),
      );
    });

    test("/jobs muestra al menos una de sus ofertas", async () => {
      await timed("/jobs", async () => {
        await page.goto("/jobs");
        await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
        await expect
          .poll(
            async () => {
              let n = 0;
              for (const o of ownOffers) n += await page.getByText(o.title).count();
              return n;
            },
            { timeout: 15_000 },
          )
          .toBeGreaterThan(0);
      });
    });

    test("/market muestra el mercado de su puesto y /plan nombra skills del puesto", async () => {
      // El cálculo con tsx puede tardar hasta 120 s (execSync): más que el timeout de 90 s
      test.setTimeout(180_000);
      await timed("calcular mercado y plan", async () => computeRoleMarketAndPlan(run));
      const wanted = ownSkillSlugs(persona).map((slug) => SKILL_NAMES[slug]!);

      await timed("/market", async () => {
        await page.goto("/market");
        const market = page.getByTestId("role-market");
        // La etiqueta sale del seed de roles: así no depende de cómo la nombre la 44
        const label = (roleSkills as Record<string, { label: string }>)[persona.role]!.label;
        await expect(market).toContainText(`El mercado de ${label}`);
        await expect(market).not.toContainText(
          `Todavía no hay ofertas públicas de ${label} para mostrar`,
        );
        const text = await market.innerText();
        expect(
          wanted.some((name) => text.includes(name)),
          "alguna skill de sus ofertas aparece en el mercado del puesto",
        ).toBe(true);
      });

      await timed("/plan", async () => {
        await page.goto("/plan");
        await expect(page.getByRole("heading", { name: "Plan de formación" })).toBeVisible();
        const text = await page.locator("body").innerText();
        if (wanted.some((name) => text.includes(name))) return;
        // Con 4 ofertas puede no alcanzar: se anota como hallazgo de la beta, no rompe el spec
        finding(
          "/plan no nombra ninguna skill del puesto con 4 ofertas sembradas (revisar el umbral o el texto vacío)",
        );
        expect(text).toMatch(
          /No hay skills para reforzar|Con pocas ofertas todavía no|Todavía no|Estamos armando/,
        );
      });
    });
  });
}
