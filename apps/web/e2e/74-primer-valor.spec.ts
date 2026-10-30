import * as s from "@job-search-os/db/schema";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import {
  E2E_USER_ID,
  assignSeededPoolJobs,
  chooseRoles,
  deleteSeededPublicJobs,
  ownerDb,
  runDemoWorker,
  seedPublicJobs,
} from "./helpers";

/**
 * Flujo 74 (C-17a): MIDE cuánto tarda, y cuántos pasos lleva, que una cuenta nueva vea su
 * primera oferta evaluada (con score). Meta: menos de 3 minutos. Solo mide: no cambia pantallas.
 * Recorrido: registro (que deja la sesión iniciada) -> onboarding -> skills -> ofertas; ya no
 * pasa por «Cuenta creada» ni por /login.
 * Evaluador falso (worker --demo): costo LLM cero. Todo inventado; se limpia al final.
 *
 * Resultado: anotación `primer-valor` y una línea `PRIMER_VALOR {json}` en el log.
 * Por pantalla: nombre (URL sin query), ms desde el arranque (al llegar), clicks, fills y
 * caracteres escritos por el test en esa pantalla.
 */
const GOAL_MS = 180_000;
const CAREER = "customer_success";

type Step = {
  paso: string;
  ms: number;
  clicks: number;
  fills: number;
  caracteres: number;
};

test.describe("Flujo 74: primer valor, de la cuenta nueva a la primera oferta evaluada", () => {
  const tag = Date.now();
  const email = `primer-valor-${tag}@example.com`;
  // Aleatoria en cada corrida: los escaneos de secretos del CI marcan cualquier literal
  const secret = randomBytes(18).toString("base64url");
  const titles = [`Oferta Ficticia CS Uno ${tag}`, `Oferta Ficticia CS Dos ${tag}`];

  let code: string;
  let invitationId: string | undefined;
  let userId: string | null = null;

  test.beforeAll(async () => {
    // Igual que createInvitation (lib/invitations.ts): código aleatorio, en la base solo su sha256
    code = randomBytes(32).toString("base64url");
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
    // La persona es de Brasil: coincide con la ubicación que deja seedPublicJobs («Remoto (Brasil)»)
    await seedPublicJobs(tag, [
      {
        title: titles[0]!,
        company: "Empresa Ficticia 1",
        sourceKind: "getonboard_api",
        roleHints: [CAREER],
      },
      {
        title: titles[1]!,
        company: "Empresa Ficticia 2",
        sourceKind: "remoteok",
        roleHints: [CAREER],
      },
    ]);
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
      const id = user?.id ?? userId;
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

  test("registro, onboarding mínimo y primera oferta con score en menos de 3 minutos", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240_000);

    const steps: Step[] = [];
    let t0 = 0;
    let current: Step | null = null;

    const pathOf = () => new URL(page.url()).pathname;
    // Abre una pantalla nueva: las acciones siguientes se cuentan en ella
    const enter = (name?: string) => {
      current = {
        paso: name ?? pathOf(),
        ms: Date.now() - t0,
        clicks: 0,
        fills: 0,
        caracteres: 0,
      };
      steps.push(current);
    };
    const click = async (target: Locator) => {
      await target.click();
      current!.clicks += 1;
    };
    // check() y selectOption() cuentan como un click: son una acción de la persona
    const check = async (target: Locator) => {
      await target.check();
      current!.clicks += 1;
    };
    const fill = async (target: Locator, text: string) => {
      await target.fill(text);
      current!.fills += 1;
      current!.caracteres += text.length;
    };
    const select = async (target: Locator, value: string) => {
      await target.selectOption(value);
      current!.clicks += 1;
    };

    // 1. Reloj: arranca en el link de invitación
    t0 = Date.now();
    await page.goto(`/register?code=${code}`);
    enter();
    await fill(page.getByLabel("Email"), email);
    // «Nombre (opcional)» se saltea
    await fill(page.getByLabel("Contraseña", { exact: true }), secret);
    await fill(page.getByLabel("Repetí la contraseña"), secret);
    await check(page.getByLabel(/Leí y acepto/));
    await click(page.getByRole("button", { name: "Crear cuenta" }));

    // 2. El registro deja la sesión iniciada: va directo al onboarding
    // 3. Onboarding paso 1: puesto, país, inglés, años, resumen y modalidad son obligatorios
    await page.waitForURL("**/onboarding**");
    enter();
    const roleInput = page.locator(`input[name="targetRoles"][value="${CAREER}"]`);
    await chooseRoles(page, [CAREER]);
    current!.clicks += 1;
    await expect(roleInput).toBeChecked();
    await fill(page.getByLabel(/País de residencia/), "BR");
    await click(page.getByRole("option", { name: /\(BR\)/ }));
    await select(page.getByLabel(/Tu nivel de inglés/), "C1");
    await fill(page.getByLabel(/Años de experiencia/), "4");
    await fill(
      page.getByLabel(/Resumen de tu perfil/),
      "Perfil ficticio de la prueba de primer valor: atención y éxito de clientes con cuatro años de experiencia.",
    );
    await check(page.getByRole("checkbox", { name: "Remoto" }));
    await click(page.getByRole("button", { name: "Guardar y continuar" }));

    // 4. Skills: se saltea
    await page.waitForURL("**/onboarding/skills**");
    enter();
    await click(page.getByRole("button", { name: "Saltear por ahora" }));

    // 5. Tus primeras ofertas: hasta ver una con score
    await page.waitForURL("**/onboarding/ofertas**");
    await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();
    enter();

    // Resolvemos la persona para asignar el pool sembrado (en e2e el pool no se descarga) y
    // evaluamos con el worker en modo demo; ambos corren sin acciones de la persona
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email));
      userId = user!.id;
    } finally {
      await close();
    }
    await assignSeededPoolJobs(userId!, tag);
    runDemoWorker();
    await expect(async () => {
      await page.goto("/onboarding/ofertas");
      await expect(page.getByTestId("first-offer-score").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000, intervals: [2_000] });
    const totalMs = Date.now() - t0;

    const resumen = {
      meta_ms: GOAL_MS,
      total_ms: totalMs,
      cumple_meta: totalMs < GOAL_MS,
      pasos: steps.length,
      clicks: steps.reduce((n, p) => n + p.clicks, 0),
      fills: steps.reduce((n, p) => n + p.fills, 0),
      caracteres: steps.reduce((n, p) => n + p.caracteres, 0),
      detalle: steps,
    };
    test.info().annotations.push({ type: "primer-valor", description: JSON.stringify(resumen) });
    console.log("PRIMER_VALOR " + JSON.stringify(resumen));

    // Se llega a una oferta con score; la meta se afirma sin topes por paso
    await expect(page.getByTestId("first-offer-score").first()).toBeVisible();
    expect(totalMs).toBeLessThan(GOAL_MS);
  });
});
