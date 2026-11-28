import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { and, eq, like, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import {
  E2E_B_EMAIL,
  E2E_B_PASSWORD,
  E2E_USER_ID,
  chooseRoles,
  jobStatus,
  ownerDb,
  removeSecondUser,
} from "./helpers";
import {
  JOB_CARD_MODE,
  deleteRequirementAnswers,
  requirementAnswersOf,
  seedEvaluatedJob,
} from "./evaluacion-r31-helpers";

/**
 * Flujo 445 (R34-05): ensayo de punta a punta con la persona B, con el modelo simulado (`LLM_DEMO=1`), sin red y
 * sin gasto. El recorrido de una persona nueva, en un celular de 390 px:
 *   1. alta con carrera (invitación, registro, paso 1 con un puesto, skills salteadas)
 *   2. primera oferta (sembrada, con el aviso y sus habilidades) en la lista
 *   3. evaluación con una pregunta de un toque, y guardar la oferta
 *   4. armar el CV por «No tengo CV» (el chat de `/cv/armar`) hasta «Guardar y ver mi CV»
 *   5. «Revisar mi CV para esta oferta» en «Preparar mi postulación»
 *   6. descargar el PDF
 *   7. ir al aviso (el enlace sale a otra pestaña; no se abre) y marcar «Ya me postulé»
 *
 * Decisiones:
 * - La persona B se da de alta de verdad por invitación con el email de B: es el email el que la pone en la etapa
 *   `testers` de JOB_CARD, así que el paso 3 coincide con lo que ve un tester. Se borra a B antes y la persona
 *   nueva se borra al final (por email, con `deleteUserData`).
 * - La oferta y su evaluación se siembran: el modelo simulado de evaluación tiene su propio spec y acá lo que se
 *   prueba es el recorrido. La pregunta de un toque solo se ofrece con `JOB_CARD=testers`; sin eso, ese tramo se
 *   saltea con el motivo y el resto corre igual.
 * - Nada se envía: el botón «Ir al aviso» es un enlace; «Ya me postulé» lo marca la persona a mano (ADR-004).
 * Datos inventados; todo se borra al final.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const TAG = Date.now();
const FILA = "Título universitario";
const CLAVE = "formacion:titulo universitario";
const EMPRESA = `Empresa Ficticia Ensayo ${TAG}`;
const TITULO = `Analista de datos ensayo ${TAG}`;
const AVISO = `https://example.com/e2e-445/${TAG}`;

function checklistConPregunta() {
  return {
    items: [
      {
        id: "req:1",
        kind: "texto",
        nivel: "must",
        pide: FILA,
        evidencia: "Título universitario o terciario",
        tenes: null,
        status: "no_se_sabe",
        fuente: { pide: "modelo", tenes: null },
        bloquea: false,
        pregunta: { clave: CLAVE, respuesta: null, nota: null },
      },
    ],
    must: { cumple: 0, no_cumple: 0, no_se_sabe: 1 },
    deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
    parcial: false,
    descarte_rapido: null,
  };
}

test.describe("Flujo 445: ensayo de punta a punta (R34-05)", () => {
  let context: BrowserContext | undefined;
  let page: Page;
  let invitationId = "";
  let userId = "";
  let jobId = "";
  let skillA = "";
  let skillB = "";

  /** Borra a la persona nueva y todo lo suyo (también una B de otra corrida). */
  async function limpiar(): Promise<void> {
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, E2E_B_EMAIL));
      if (user) {
        await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, user.id));
        await db
          .delete(s.llmCalls)
          .where(and(eq(s.llmCalls.userId, user.id), like(s.llmCalls.label, "cv:%")));
        await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
            await deleteUserData(tx as never, user.id);
          })
          .catch(() => {});
        await db.delete(s.jobs).where(eq(s.jobs.userId, user.id));
        await db.delete(s.users).where(eq(s.users.id, user.id));
      }
      if (invitationId) await db.delete(s.invitations).where(eq(s.invitations.id, invitationId));
    } finally {
      await close();
    }
  }

  test.beforeAll(async ({ browser }) => {
    // Una B de otra corrida (con el id fijo de los demás specs) no puede quedar: el email es único
    await removeSecondUser();
    await limpiar();
    const { db, close } = ownerDb();
    try {
      const sk = await db.select({ id: s.skills.id, name: s.skills.name }).from(s.skills).limit(2);
      expect(sk.length).toBe(2);
      skillA = sk[0]!.name;
      skillB = sk[1]!.name;
    } finally {
      await close();
    }
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (userId) await deleteRequirementAnswers(userId);
    await context?.close().catch(() => {});
    await limpiar();
    await removeSecondUser();
  });

  test("1. alta con carrera: invitación, registro y paso 1 con un puesto", async () => {
    const code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email: E2E_B_EMAIL, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;
    } finally {
      await close();
    }
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(E2E_B_EMAIL);
    await page.getByLabel("Nombre (opcional)").fill("Persona B");
    await page.getByLabel("Contraseña", { exact: true }).fill(E2E_B_PASSWORD);
    await page.getByLabel("Repetí la contraseña").fill(E2E_B_PASSWORD);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.waitForURL(/\/(onboarding|hoy)/);
    await page.goto("/onboarding");
    await page.waitForURL("**/onboarding**");

    // Paso 1: la carrera es obligatoria; con un puesto elegido guarda
    await chooseRoles(page, ["abogacia"]);
    await page.getByLabel(/País de residencia/).fill("UY");
    await page.getByRole("option", { name: /\(UY\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("B2");
    await page.getByLabel(/Años de experiencia/).fill("4");
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio del flujo 445. Trabajo en proyectos de documentación y atención a clientes, con experiencia en equipos chicos. Sin datos reales.",
      );
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
    await page.getByRole("button", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/ofertas**");
    await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();

    const { db: db2, close: close2 } = ownerDb();
    try {
      const [u] = await db2
        .select({ id: s.users.id, roles: s.profiles.targetRoles })
        .from(s.users)
        .innerJoin(s.profiles, eq(s.profiles.userId, s.users.id))
        .where(eq(s.users.email, E2E_B_EMAIL));
      expect(u?.roles).toEqual(["abogacia"]);
      userId = u!.id;
    } finally {
      await close2();
    }
  });

  test("2. la primera oferta aparece en la lista", async () => {
    const seeded = await seedEvaluatedJob({
      userId,
      tag: `445-${TAG}`,
      title: TITULO,
      checklist: checklistConPregunta(),
    });
    jobId = seeded.jobId;
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.jobs)
        .set({ companyRaw: EMPRESA, canonicalUrl: AVISO })
        .where(eq(s.jobs.id, jobId));
      const sk = await db.select({ id: s.skills.id }).from(s.skills).limit(2);
      await db.insert(s.jobSkills).values([
        { jobId, skillId: sk[0]!.id, isMust: true },
        { jobId, skillId: sk[1]!.id, isMust: false },
      ]);
    } finally {
      await close();
    }
    await page.goto("/jobs");
    await expect(page.getByRole("link", { name: TITULO }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("3. evaluación con una pregunta de un toque, y guardar la oferta", async () => {
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(TITULO);
    if (JOB_CARD_MODE === "testers") {
      const grupo = page.getByRole("group", { name: `Tu respuesta sobre: ${FILA}` });
      await expect(grupo.getByText("¿Tenés esto?")).toBeVisible();
      await grupo.getByRole("button", { name: "Sí", exact: true }).click();
      await expect
        .poll(async () => (await requirementAnswersOf(userId)).map((r) => r.answer))
        .toEqual(["si"]);
    } else {
      test.info().annotations.push({
        type: "tramo salteado",
        description: "la pregunta de un toque necesita JOB_CARD=testers (E2E_JOB_CARD_MODE)",
      });
    }
    await page.getByTestId("guardar-oferta").click();
    await expect(page.getByTestId("marca-guardada")).toBeVisible();
  });

  test("4. armar el CV por «No tengo CV»", async () => {
    const answerFor = (question: string): string | null => {
      const q = question.toLowerCase();
      if (q.includes("desde cuándo")) return "03/2021 - actual";
      if (q.includes("qué cargo")) return "Analista Junior";
      if (q.includes("qué hacías"))
        return `Armé reportes semanales con ${skillA}; automaticé la revisión de reportes`;
      if (q.includes("logro")) return "Bajé el tiempo de revisión de 5 a 3 días";
      if (q.includes("otro trabajo")) return "no";
      if (q.includes("qué estudios"))
        return "Universidad Ficticia, Licenciatura en Estadística, 2013 - 2018";
      if (q.includes("certificaciones")) return "no";
      if (q.includes("herramientas")) return `${skillA}, ${skillB}`;
      if (q.includes("idiomas")) return "Inglés B2, Portugués";
      if (q.includes("links")) return "no";
      if (q.includes("qué puesto") || q.includes("a qué puesto")) return "Analista de datos";
      if (q.includes("empresa")) return EMPRESA;
      return null;
    };

    await page.goto("/cv");
    // C-02 (R33-01): «No tengo CV» sale solo sin nada cargado. Después del alta la persona ya tiene su nivel de
    // inglés (obligatorio en el paso 1), así que «Tu CV» está en el estado parcial y el mismo camino al chat es
    // «Seguir armando mi CV». La puerta vacía la prueba el 142.
    const door = page.getByTestId("cv-door");
    if ((await door.count()) > 0) {
      await door.getByRole("link", { name: "No tengo CV", exact: true }).click();
    } else {
      await expect(page.getByTestId("cv-seguir")).toHaveAttribute("href", "/cv/armar");
      await page.getByTestId("cv-seguir").click();
    }
    await page.waitForURL("**/cv/armar**");
    await page.getByRole("button", { name: "Empezar", exact: true }).click();

    const answer: Locator = page.getByLabel("Tu respuesta");
    const review = page.getByRole("heading", { name: "Esto es lo que entendí", level: 2 });
    const send = page.getByRole("button", { name: /^(Responder y seguir|Enviar)$/ });
    for (let i = 0; i < 30 && !(await review.isVisible()); i++) {
      const log = page.getByTestId("cv-messages").locator("p");
      const question = (await log.last().innerText()).trim();
      const reply = answerFor(question);
      if (reply === null) {
        await page
          .getByRole("button", { name: /Saltear/ })
          .or(page.getByRole("link", { name: /Saltear/ }))
          .first()
          .click();
      } else {
        await answer.fill(reply);
        await send.click();
      }
      await expect
        .poll(async () => (await review.isVisible()) || (await answer.isEnabled()))
        .toBe(true);
    }
    await expect(review).toBeVisible();
    await page.getByRole("button", { name: "Armar mi CV" }).click();
    await expect(page.getByRole("heading", { name: "Así queda tu CV", level: 2 })).toBeVisible();
    await page.getByRole("button", { name: "Guardar y ver mi CV" }).click();
    await expect(page.getByTestId("cv-saved")).toContainText("Guardamos");
  });

  test("5. «Revisar mi CV para esta oferta» en «Preparar mi postulación»", async () => {
    await page.goto(`/jobs/${jobId}/postular`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Preparar mi postulación" }),
    ).toBeVisible();
    const seccion = page.getByTestId("postular-cv-oferta");
    await expect(
      seccion.getByRole("heading", { level: 2, name: "Revisar mi CV para esta oferta" }),
    ).toBeVisible();
    // Lo que pide el aviso y el CV ya muestra: la habilidad indispensable figura en la experiencia armada
    await expect(seccion.getByTestId("cv-oferta-pedidas")).toContainText(skillA);
    await expect(seccion.getByTestId("cv-oferta-aclarar")).toBeVisible();
    // Coincidir no es tener probabilidad de que te contraten, y nada se envía desde acá
    await expect(seccion).toContainText(
      "no es lo mismo que tener probabilidad de que te contraten",
    );
    await expect(page.getByText("Nada se envía desde la app")).toBeVisible();
  });

  test("6. descargar el PDF", async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("descargar-base-pdf").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^CV-[A-Za-z0-9-]+\.pdf$/);
    const path = await download.path();
    expect(readFileSync(path).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  test("7. ir al aviso y marcar «Ya me postulé»", async () => {
    // El enlace sale a otra pestaña y es https: no se abre (nada de afuera en un e2e)
    const ir = page.getByTestId("ir-al-aviso");
    await expect(ir).toHaveAttribute("href", AVISO);
    await expect(ir).toHaveAttribute("target", "_blank");
    // Hasta que la persona lo marca, la oferta no figura como postulada
    expect(await jobStatus(jobId)).not.toBe("aplicada");

    await page.goto(`/jobs/${jobId}`);
    await page.getByRole("button", { name: "Ya me postulé" }).click();
    await expect(page.getByRole("button", { name: "Ya me postulé" })).toHaveCount(0);
    await expect(page.getByText("Ya me postulé", { exact: true })).toBeVisible();
    expect(await jobStatus(jobId)).toBe("aplicada");
  });
});
