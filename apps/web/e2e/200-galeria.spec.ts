import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { axeSummary, settleBrandMotion } from "./axe-helpers";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
  type SecondUserData,
} from "./helpers";

/**
 * Flujo 200 (R24-01): galería de capturas para Ani. Recorre con la persona B (ficticia, solo en la base
 * local) las pantallas principales a 390 y 1280 px, en claro y en oscuro: primero los vacíos, después con
 * datos inventados. Sin señal solo recorre y comprueba que cada pantalla cargue (título visible, sin
 * error, sin scroll horizontal). Con `CAPTURAS=1` o si existe `ops/capturas/r24/.generar` guarda las
 * capturas en `ops/capturas/r24/` como `NN-pantalla-ancho-tema.png` (la carpeta no se versiona).
 *
 * Corre en serie y usa la persona B: no correrlo junto con los flujos 180 a 182 ni 186. Modelo simulado
 * (`LLM_DEMO=1`) para Interview. Todo se borra al final.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r24");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));

const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;
type Theme = (typeof THEMES)[number];

const TAG = `200-${Date.now()}`;
const GOOD_ANSWER =
  "Cuando el cierre mensual tardaba dos días en mi proyecto, armé un tablero con SQL y logré bajarlo a una hora, un 80% menos.";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

type Gallery = { base: SecondUserData; top: string; mid: string; far: string };
let gallery: Gallery | null = null;

async function cleanInterview(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "interview%")));
  } finally {
    await close();
  }
}

async function cleanAll(): Promise<void> {
  await cleanInterview();
  const { db, close } = ownerDb();
  try {
    // Sin clave foránea hacia users: no se borran solos con la cuenta
    await db.delete(s.candidateFacts).where(eq(s.candidateFacts.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
  // Ofertas, evaluaciones, postulaciones, historial y skills (cascade) y la cuenta
  await removeSecondUser();
}

async function insertEvaluatedJob(
  title: string,
  company: string,
  score: number,
  accion: "aplicar" | "guardar" | "descartar",
  riesgos: string[],
): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const url = `https://example.com/e2e-galeria/${TAG}/${encodeURIComponent(title)}`;
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: E2E_B_USER_ID,
        companyRaw: company,
        title,
        titleNormalized: title.toLowerCase(),
        canonicalUrl: url,
        locationRaw: "Remoto (Argentina)",
        modality: "remoto",
        status: "evaluada",
        jdText: `Oferta ficticia para la galería. Buscamos a alguien con SQL, planillas y ganas de aprender. Se trabaja en equipo, con reuniones cortas y objetivos claros.`,
        flags: [],
        firstSeenAt: new Date(),
      })
      .returning({ id: s.jobs.id });
    await db.insert(s.jobSources).values({
      jobId: job!.id,
      kind: "manual",
      // El tag va acá y en la URL (columnas internas); los títulos que se ven quedan limpios
      sourceName: `e2e-galeria-${TAG}`,
      url,
      seenAt: new Date(),
    });
    await db.insert(s.evaluations).values({
      jobId: job!.id,
      userId: E2E_B_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: true,
      score,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "Evaluación ficticia para la galería.",
      accion,
      riesgos,
    });
    return job!.id;
  } finally {
    await close();
  }
}

/** Datos inventados de B: tres ofertas evaluadas, perfil con titular, historial, skills y un logro. */
async function seedGallery(): Promise<Gallery> {
  const base = await seedSecondUserData(TAG);
  const top = await insertEvaluatedJob(
    "Analista de Datos Ficticio",
    "Empresa de Prueba A",
    9.2,
    "aplicar",
    [],
  );
  const mid = await insertEvaluatedJob(
    "Asistente Administrativo Ficticio",
    "Empresa de Prueba B",
    6.4,
    "guardar",
    ["Salario no publicado"],
  );
  const far = await insertEvaluatedJob(
    "Puesto Lejano Ficticio",
    "Empresa de Prueba C",
    1.5,
    "descartar",
    [],
  );
  const { db, close } = ownerDb();
  try {
    // La oferta base del helper lleva el tag en el título y en el veredicto: se dejan limpios
    await db
      .update(s.jobs)
      .set({
        title: "Contador Junior Ficticio",
        titleNormalized: "contador junior ficticio",
        companyRaw: "Empresa de Prueba E",
        jdText: "Oferta ficticia para la galería. Se piden nociones de contabilidad y orden.",
      })
      .where(eq(s.jobs.id, base.jobId));
    await db
      .update(s.evaluations)
      .set({ veredicto: "Evaluación ficticia para la galería." })
      .where(eq(s.evaluations.jobId, base.jobId));
    await db
      .update(s.profiles)
      .set({
        headline: "Analista de datos ficticia",
        locationCity: "Ciudad Ficticia",
        englishCefr: "B2",
      })
      .where(eq(s.profiles.userId, E2E_B_USER_ID));
    await db.insert(s.careerHistory).values([
      {
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa de Prueba D",
        title: "Analista de reportes",
        startMonth: "2022-03",
        endMonth: null,
        bullets: [
          "Armé un tablero mensual en SQL que bajó el cierre de dos días a una hora",
          "Coordiné reuniones semanales con tres áreas",
        ],
        sort: 0,
      },
      {
        userId: E2E_B_USER_ID,
        kind: "educacion",
        organization: "Instituto Ficticio",
        title: "Tecnicatura en Análisis de Datos",
        startMonth: "2018-03",
        endMonth: "2021-12",
        bullets: [],
        sort: 1,
      },
    ]);
    await db.insert(s.userSkills).values([
      { userId: E2E_B_USER_ID, name: "SQL", level: 3 },
      { userId: E2E_B_USER_ID, name: "Planillas de cálculo", level: 3 },
      { userId: E2E_B_USER_ID, name: "Tableros", level: 2 },
    ]);
    await db.insert(s.candidateFacts).values({
      userId: E2E_B_USER_ID,
      key: `galeria-${TAG}`,
      project: "Proyecto Ficticio",
      claim: "Reduje el tiempo del cierre mensual",
      metric: "80% menos",
      source: "autodeclarado",
      verification: "autodeclarado",
    });
  } finally {
    await close();
  }
  return { base, top, mid, far };
}

/** Voz simulada para «Dictar» (el navegador de prueba no trae reconocimiento de voz). */
async function prepare(page: Page, width: number, theme: Theme): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
  await page.addInitScript(() => {
    class FakeRecognition {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => this.onstart?.(), 0);
      }
      stop() {
        setTimeout(() => this.onend?.(), 0);
      }
      abort() {
        this.stop();
      }
    }
    Object.assign(window, {
      SpeechRecognition: FakeRecognition,
      webkitSpeechRecognition: FakeRecognition,
    });
  });
}

/** Pantallas principales: además de la de página entera, una de viewport con las barras fijas a la vista. */
const VIEWPORT_NUMS = new Set(["10", "11", "13", "15", "16", "17", "21"]);

/** Resultados de axe por pantalla (R24-03). Se juntan sin fallar el test y se escriben al final. */
type AxeRow = {
  screen: string;
  width: number;
  theme: string;
  rule: string;
  nodes: number;
  impact: string;
};
const AXE_ROWS = new Map<string, AxeRow>();
const AXE_MEASURED = new Set<string>();

/** Esconde las herramientas de desarrollo de Next (el botón «N»): no son parte de la app. */
async function hideDevChrome(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

/**
 * Para la captura de página entera, esconde lo que está fijo en la ventana (pestañas de abajo, «Postularme en
 * el sitio del aviso», botón de feedback): en una imagen larga quedaría en el medio tapando contenido. Los
 * diálogos no se tocan. Devuelve cómo deshacerlo.
 */
async function hideFixedBars(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const keep = '[role="dialog"],[data-testid="primer-uso"]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (getComputedStyle(el).position !== "fixed") continue;
      if (el.closest(keep) || el.querySelector(keep)) continue;
      el.setAttribute("data-captura-fija", "1");
    }
  });
  const style = await page.addStyleTag({ content: "[data-captura-fija]{display:none!important}" });
  return async () => {
    await style.evaluate((el) => (el as Element).remove());
    await page.evaluate(() =>
      document
        .querySelectorAll("[data-captura-fija]")
        .forEach((el) => el.removeAttribute("data-captura-fija")),
    );
  };
}

async function collectAxe(page: Page, num: string, name: string, width: number, theme: Theme) {
  const screen = `${num}-${name}`;
  const { violations, unmeasured } = await axeSummary(page, ['[data-logo-fondo="accent"]']);
  AXE_MEASURED.add(`${screen}|${width}|${theme}`);
  for (const v of violations) {
    const m = /^(\S+) \((.*?)\): (.*)$/.exec(v);
    const rule = m?.[1] ?? v;
    AXE_ROWS.set(`${screen}|${width}|${theme}|${rule}`, {
      screen,
      width,
      theme,
      rule,
      nodes: (m?.[3] ?? "").split(" | ").length,
      impact: m?.[2] ?? "sin impacto",
    });
  }
  for (const u of unmeasured) {
    AXE_ROWS.set(`${screen}|${width}|${theme}|${u}`, {
      screen,
      width,
      theme,
      rule: u,
      nodes: 1,
      impact: "sin medir",
    });
  }
}

/** Comprueba que la pantalla cargó y, con señal, guarda la captura (y mide axe sin fallar). */
async function shot(page: Page, num: string, name: string, width: number, theme: Theme) {
  const label = `${num}-${name} ${width} ${theme}`;
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading").first(), label).toBeVisible();
  await expect(page.locator("body"), label).not.toContainText("Application error");
  await hideDevChrome(page);
  await settleBrandMotion(page);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  // Blanda: un desborde se reporta pero no impide sacar el resto de las capturas
  expect.soft(scrollWidth, `scroll horizontal en ${label}`).toBeLessThanOrEqual(innerWidth);
  if (!SHOTS) return;
  await collectAxe(page, num, name, width, theme).catch(() => undefined);
  mkdirSync(OUT, { recursive: true });
  if (VIEWPORT_NUMS.has(num)) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(OUT, `${num}-${name}-viewport-${width}-${theme}.png`) });
  }
  const restore = await hideFixedBars(page);
  try {
    await page.screenshot({
      path: join(OUT, `${num}-${name}-${width}-${theme}.png`),
      fullPage: true,
    });
  } finally {
    await restore();
  }
}

function writeAxeReport(): void {
  if (!SHOTS) return;
  const rows = [...AXE_ROWS.values()].sort(
    (a, b) =>
      a.screen.localeCompare(b.screen) || a.width - b.width || a.theme.localeCompare(b.theme),
  );
  const lines = [
    "# axe en la galería (R24-01, para R24-03)",
    "",
    `Pantallas medidas: ${AXE_MEASURED.size} (pantalla × ancho × tema), reglas WCAG 2.0/2.1 A y AA. Generado por \`e2e/200-galeria.spec.ts\`; no es una aserción: no falla el test.`,
    `Hallazgos: ${rows.length}.`,
    "",
    "| Pantalla | Ancho | Tema | Regla | Nodos | Severidad |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(rows.length === 0
      ? ["| (ninguna) | | | sin violaciones | 0 | |"]
      : rows.map(
          (r) => `| ${r.screen} | ${r.width} | ${r.theme} | ${r.rule} | ${r.nodes} | ${r.impact} |`,
        )),
    "",
  ];
  const dir = join(__dirname, "..", "..", "..", "ops", "rondas", "r24-tanda");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "axe-galeria.md"), lines.join("\n"));
}

async function visit(
  page: Page,
  num: string,
  name: string,
  path: string,
  width: number,
  theme: Theme,
  expectedStatus = 200,
): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status(), `${num}-${name} ${path}`).toBe(expectedStatus);
  await shot(page, num, name, width, theme);
}

test.afterAll(async () => {
  writeAxeReport();
  await cleanAll();
});

test.describe("portada (sin sesión)", () => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`portada a ${width} px en ${theme}`, async ({ page }) => {
        await prepare(page, width, theme);
        await visit(page, "01", "portada", "/", width, theme);
      });
    }
  }
});

test.describe("vacíos (persona sin datos)", () => {
  test.beforeAll(async () => {
    await ensureSecondUser();
    await cleanInterview();
  });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`vacíos a ${width} px en ${theme}`, async ({ page }) => {
        await prepare(page, width, theme);
        await loginAsSecondUser(page);
        const screens: Array<[string, string, string]> = [
          ["02", "hoy-vacio", "/hoy"],
          ["03", "match-vacio", "/jobs"],
          ["04", "tracker-vacio", "/applications"],
          ["05", "cv-vacio", "/cv"],
          ["06", "inbox-vacio", "/inbox"],
          ["07", "interview-inicio", "/interview"],
          ["08", "academy-vacia", "/academy"],
        ];
        for (const [num, name, path] of screens) await visit(page, num, name, path, width, theme);
        // La última pantalla es Academy: sin fichas aprobadas muestra el vacío con marca
        await expect(page.getByTestId("academy-vacia")).toBeVisible();
      });
    }
  }
});

test.describe("con datos inventados", () => {
  test.beforeAll(async () => {
    gallery = await seedGallery();
  });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`Hoy, Match, oferta, Preparar y CV a ${width} px en ${theme}`, async ({ page }) => {
        const g = gallery!;
        await prepare(page, width, theme);
        await loginAsSecondUser(page);
        await visit(page, "10", "hoy", "/hoy", width, theme);
        await visit(page, "11", "match", "/jobs?estado=todas", width, theme);
        if (width === 1280) {
          await visit(
            page,
            "12",
            "match-panel",
            `/jobs?estado=todas&oferta=${g.top}`,
            width,
            theme,
          );
        }

        // La oferta con el sello abierto (el detalle de cómo se compone el puntaje)
        const res = await page.goto(`/jobs/${g.top}`);
        expect(res?.status()).toBe(200);
        const detail = page.getByTestId("afinidad-detalle");
        await expect(detail).toBeVisible();
        await detail.getByText("Ver cómo se compone el puntaje").click();
        await expect(detail).toHaveAttribute("open", "");
        await expect(detail.getByRole("meter").first()).toBeVisible();
        // Las barras se llenan con una transición corta
        await page.waitForTimeout(800);
        await shot(page, "13", "oferta-sello", width, theme);

        await visit(page, "14", "oferta-lejana", `/jobs/${g.far}`, width, theme);
        await visit(page, "15", "preparar", `/jobs/${g.top}/postular`, width, theme);
        await visit(page, "16", "cv-diagnostico", "/cv", width, theme);
        await expect(page.getByTestId("cv-diagnosis")).toBeVisible();
        await visit(page, "17", "tracker", "/applications", width, theme);
        await visit(page, "18", "encaje", "/encaje", width, theme);
      });

      test(`Interview de punta a punta a ${width} px en ${theme}`, async ({ page }) => {
        const g = gallery!;
        await cleanInterview();
        await prepare(page, width, theme);
        await loginAsSecondUser(page);

        // Una simulación en curso, sobre la oferta de la galería
        const { db, close } = ownerDb();
        let sessionId: string | undefined;
        try {
          const [row] = await db
            .insert(s.interviewSessions)
            .values({
              userId: E2E_B_USER_ID,
              sourceKind: "job",
              jobId: g.top,
              title: `Analista de Datos Ficticio · Empresa de Prueba A`,
              questions: [
                "Contanos de una vez que mejoraste un proceso con datos.",
                "¿Cómo priorizás cuando tenés tres pedidos urgentes?",
                "Pregunta ficticia número 3 de la simulación",
                "Pregunta ficticia número 4 de la simulación",
                "Pregunta ficticia número 5 de la simulación",
              ],
            })
            .returning({ id: s.interviewSessions.id });
          sessionId = row!.id;
        } finally {
          await close();
        }

        await visit(page, "20", "interview-historial", "/interview", width, theme);
        await visit(page, "21", "interview-pregunta", `/interview/${sessionId}`, width, theme);

        // El dictado: la barra de «Escuchando…» con la voz simulada
        const boton = page.getByTestId("dictar-boton");
        if ((await boton.count()) > 0) {
          await boton.click();
          await expect(page.getByTestId("dictar-escuchando")).toContainText("Escuchando");
          await shot(page, "22", "interview-dictado", width, theme);
          await boton.click();
        }

        // Una devolución (modelo simulado)
        await page.getByTestId("interview-answer").fill(GOOD_ANSWER);
        await page.getByTestId("interview-send").click();
        await expect(page.getByTestId("interview-feedback")).toBeVisible({ timeout: 20_000 });
        await shot(page, "23", "interview-devolucion", width, theme);

        // El informe de una simulación terminada, con puntajes conocidos
        await cleanInterview();
        const db2 = ownerDb();
        let doneId: string | undefined;
        try {
          const [row] = await db2.db
            .insert(s.interviewSessions)
            .values({
              userId: E2E_B_USER_ID,
              sourceKind: "job",
              jobId: g.top,
              title: `Analista de Datos Ficticio · Empresa de Prueba A`,
              questions: [1, 2, 3, 4, 5].map(
                (n) => `Pregunta ficticia número ${n} de la simulación`,
              ),
              status: "terminada",
              finishedAt: new Date(),
            })
            .returning({ id: s.interviewSessions.id });
          doneId = row!.id;
          const scores: Array<[number, number, number]> = [
            [9, 9, 8],
            [3, 4, 2],
            [5, 8, 8],
            [8, 4, 8],
            [8, 7, 3],
          ];
          await db2.db.insert(s.interviewAnswers).values(
            scores.map(([clarity, relevance, star], position) => ({
              sessionId: row!.id,
              userId: E2E_B_USER_ID,
              position,
              answer: `Respuesta ficticia ${position + 1} con una situación, una acción y un resultado.`,
              clarity,
              relevance,
              star,
              tip: `Consejo ficticio de la pregunta ${position + 1}`,
              example: `Ejemplo ficticio de la pregunta ${position + 1}`,
              model: "fake",
            })),
          );
        } finally {
          await db2.close();
        }
        await visit(page, "24", "interview-informe", `/interview/${doneId}`, width, theme);
        await expect(page.getByTestId("interview-report")).toBeVisible();
        await visit(page, "25", "interview-historial-con-datos", "/interview", width, theme);
        await cleanInterview();
      });

      test(`Academy, ficha y plan a ${width} px en ${theme}`, async ({ page }) => {
        await prepare(page, width, theme);
        await loginAsSecondUser(page);
        await visit(page, "30", "academy", "/academy", width, theme);

        // Todas las fichas están en borrador y no hay forma de verlas sin aprobarlas en el repo (o en la
        // base: no hay estado en la base, son archivos): se captura lo que ve la persona, el 404 propio.
        const dir = join(__dirname, "..", "content", "academy");
        const slug = readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.replace(/\.md$/, ""))
          .find(
            (sl) => !/^estado:\s*aprobada\s*$/m.test(readFileSync(join(dir, `${sl}.md`), "utf8")),
          );
        if (slug) {
          await visit(page, "31", "academy-ficha-borrador", `/academy/${slug}`, width, theme, 404);
        }

        // Tu plan: con PRICING_ENABLED y un link de pago válido en el servidor aparece «Ya pagué»
        await visit(page, "32", "plan-ajustes", "/settings", width, theme);
        const yaPague = (await page.getByTestId("ya-pague").count()) > 0;
        test.info().annotations.push({
          type: "ya-pague",
          description: yaPague ? "visible" : "no visible (PRICING_ENABLED/MP_LINK_LISTA apagados)",
        });
        if (yaPague) {
          await page.getByTestId("ya-pague").scrollIntoViewIfNeeded();
          await shot(page, "33", "plan-ya-pague", width, theme);
        }
      });

      test(`recorrido de primer uso a ${width} px en ${theme}`, async ({ page }) => {
        await prepare(page, width, theme);
        await page.addInitScript(() => localStorage.setItem("jso-primer-uso-forzar", "1"));
        await loginAsSecondUser(page);
        const dialog = page.getByTestId("primer-uso");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText("Paso 1 de 4")).toBeVisible();
        await shot(page, "40", "primer-uso-paso1", width, theme);
        for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Siguiente" }).click();
        await expect(dialog.getByText("Paso 4 de 4")).toBeVisible();
        await shot(page, "41", "primer-uso-paso4", width, theme);
        await page.getByRole("button", { name: "Listo" }).click();
        await expect(dialog).toHaveCount(0);
      });
    }
  }
});
