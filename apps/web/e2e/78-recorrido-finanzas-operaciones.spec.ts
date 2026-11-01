import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq, inArray, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import {
  E2E_USER_ID,
  assignSeededPoolJobs,
  chooseRoles,
  deleteSeededPublicJobs,
  ownerDb,
  seedPublicJobs,
} from "./helpers";

/**
 * Flujo 78 (U3): el recorrido de una persona nueva en las carreras que abrió el #202: registro,
 * onboarding eligiendo la carrera, primeras ofertas del pool y /plan sin errores.
 *
 * Carreras cubiertas: SOLO `finanzas_contabilidad`. `asistencia_operaciones` está en
 * `UNLISTED_ROLE_KEYS` (packages/pipeline/src/skills/self-assessment.ts): no se ofrece en el
 * selector del onboarding, así que una cuenta nueva no puede elegirla (el spec 75 ya lo verifica).
 * Cuando se publique, alcanza con sumarla a CAREERS.
 *
 * Sin LLM ni worker: el pool se siembra y se asigna a mano. El recálculo de mercado y plan corre en
 * `after()` al guardar el paso 1 y puede terminar antes o después de visitar /plan: por eso /plan
 * tiene que mostrar un estado coherente (con o sin plan), no un plan puntual.
 * Todo inventado; cada carrera usa su propio tag, su propia cuenta y se limpia al final.
 */
const CAREERS = [
  {
    key: "finanzas_contabilidad",
    label: "Contaduría, impuestos y finanzas",
    titles: ["Analista Contable Ficticio", "Analista de Finanzas Ficticio", "Tesorería Ficticia"],
  },
] as const;
// Carrera de otra familia para el control negativo: su aviso no tiene que aparecer
const OTHER_CAREER = "customer_success";

/**
 * Estados válidos de /plan: con plan («prioridad alta · nivel …»), o alguna de las explicaciones de
 * «no hay». Sin «Prioridad» suelta: aparece siempre en «Cómo se calcula» y haría pasar cualquier cosa.
 */
const PLAN_STATES =
  /prioridad \w+ · nivel|No hay skills para reforzar|Con pocas ofertas todavía no|Todavía no encontramos|Estamos armando tu mercado|Todavía no llegaron ofertas/;

async function userIdOf(email: string): Promise<string | undefined> {
  const { db, close } = ownerDb();
  try {
    const [user] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, email));
    return user?.id;
  } finally {
    await close();
  }
}

for (const career of CAREERS) {
  test.describe(`Flujo 78: recorrido de una persona nueva en ${career.key}`, () => {
    const tag = Date.now();
    const email = `recorrido-${career.key}-${tag}@example.com`;
    // Aleatoria en cada corrida: los escaneos de secretos del CI marcan cualquier literal
    const secret = randomBytes(18).toString("base64url");
    const code = randomBytes(32).toString("base64url");
    const ownTitles = career.titles.map((t, i) => `${t} ${i + 1} ${tag}`);
    const controlTitle = `Oferta Ficticia de Otra Carrera ${tag}`;
    let invitationId: string | undefined;

    test.beforeAll(async () => {
      // Igual que createInvitation (lib/invitations.ts): en la base solo el sha256 del código
      const codeHash = createHash("sha256").update(code).digest("hex");
      const { db, close } = ownerDb();
      try {
        const [row] = await db
          .insert(s.invitations)
          .values({ codeHash, email, createdByUserId: E2E_USER_ID })
          .returning({ id: s.invitations.id });
        invitationId = row!.id;
      } finally {
        await close();
      }
      const ids = await seedPublicJobs(tag, [
        ...ownTitles.map((title, i) => ({
          title,
          company: `Empresa de Prueba ${i + 1}`,
          sourceKind: "getonboard_api" as const,
          roleHints: [career.key],
        })),
        {
          title: controlTitle,
          company: "Empresa de Prueba Control",
          sourceKind: "remoteok" as const,
          roleHints: [OTHER_CAREER],
        },
      ]);
      // Abiertas a cualquier país: la ubicación de la persona no las descarta
      const { db: db2, close: close2 } = ownerDb();
      try {
        await db2
          .update(s.publicJobs)
          .set({ locationRaw: "Remoto (Anywhere in the World)" })
          .where(inArray(s.publicJobs.id, ids));
      } finally {
        await close2();
      }
    });

    // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
    test.afterAll(async () => {
      await deleteSeededPublicJobs(tag).catch(() => {});
      const { db, close } = ownerDb();
      try {
        const [user] = await db
          .select({ id: s.users.id })
          .from(s.users)
          .where(eq(s.users.email, email))
          .catch(() => []);
        const id = user?.id;
        if (id) {
          await db
            .transaction(async (tx) => {
              await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
              await deleteUserData(tx as never, id);
            })
            .catch(() => {});
          // Lo que corre en `after()` al guardar el perfil puede escribir después del borrado
          await db
            .delete(s.jobs)
            .where(eq(s.jobs.userId, id))
            .catch(() => {});
        }
        if (invitationId) {
          await db
            .delete(s.invitations)
            .where(eq(s.invitations.id, invitationId))
            .catch(() => {});
        }
      } finally {
        await close().catch(() => {});
      }
    });

    test("registro, onboarding, primeras ofertas y /plan", async ({ page }: { page: Page }) => {
      test.setTimeout(180_000);

      // 1. Registro: deja la sesión iniciada y va al onboarding (la URL cambia: waitForURL sirve)
      await page.goto(`/register?code=${code}`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(secret);
      await page.getByLabel("Repetí la contraseña").fill(secret);
      await page.getByLabel(/Leí y acepto/).check();
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await page.waitForURL("**/onboarding**");

      // 2. Onboarding paso 1 con la carrera elegida
      const roleInput = page.locator(`input[name="targetRoles"][value="${career.key}"]`);
      await expect(roleInput).toHaveCount(1);
      await chooseRoles(page, [career.key]);
      await expect(roleInput).toBeChecked();
      await page.getByLabel(/País de residencia/).fill("BR");
      await page.getByRole("option", { name: /\(BR\)/ }).click();
      await page.getByLabel(/Tu nivel de inglés/).selectOption("C1");
      await page.getByLabel(/Años de experiencia/).fill("4");
      await page
        .getByLabel(/Resumen de tu perfil/)
        // Más de 80 caracteres (MIN_SUMMARY_CHARS), con margen: si no, el paso 1 no guarda
        .fill(
          "Perfil ficticio de la prueba de recorrido: cuatro años en tareas de finanzas, contabilidad y conciliaciones.",
        );
      await page.getByRole("checkbox", { name: "Remoto" }).check();
      await page.getByRole("button", { name: "Guardar y continuar" }).click();
      await page.waitForURL("**/onboarding/skills**");

      // La carrera quedó guardada en el perfil
      await expect
        .poll(
          async () => {
            const { db, close } = ownerDb();
            try {
              const [row] = await db
                .select({ targetRoles: s.profiles.targetRoles })
                .from(s.users)
                .innerJoin(s.profiles, eq(s.profiles.userId, s.users.id))
                .where(eq(s.users.email, email));
              return row?.targetRoles ?? null;
            } finally {
              await close();
            }
          },
          { timeout: 15_000 },
        )
        .toEqual([career.key]);

      // 3. Skills: se saltea
      await page.getByRole("button", { name: "Saltear por ahora" }).click();
      await page.waitForURL("**/onboarding/ofertas**");
      await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();

      // 4. Primeras ofertas: en e2e el pool no se descarga, se asigna el sembrado a esta persona
      const userId = await userIdOf(email);
      expect(userId, "el registro crea a la persona").toBeTruthy();
      await assignSeededPoolJobs(userId!, tag);
      await page.goto("/onboarding/ofertas");
      for (const title of ownTitles) {
        const card = page.getByTestId("first-offer").filter({ hasText: title });
        await expect(card).toBeVisible();
        await expect(card).toContainText("Publicado en ");
      }
      // El aviso de otra carrera no se asigna ni se muestra
      expect(await page.content()).not.toContain(controlTitle);

      // 5. /plan: sin errores y con un estado coherente (con o sin plan, según el `after()`)
      const res = await page.goto("/plan");
      expect(res?.status()).toBeLessThan(400);
      await expect(page.getByRole("heading", { name: "Plan de formación" })).toBeVisible();
      const text = await page.getByRole("main").innerText();
      expect(text).not.toMatch(/Application error|Internal Server Error|Algo salió mal/i);
      expect(text).toMatch(PLAN_STATES);
    });
  });
}
