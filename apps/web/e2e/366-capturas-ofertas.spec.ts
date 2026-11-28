import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { settleBrandMotion } from "./axe-helpers";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 366 (R30-14): capturas del listado y del detalle de ofertas, antes y después de la tanda R30, a 390 y
 * 1280 px, en claro y en oscuro. Solo con `CAPTURAS=1` o si existe `ops/capturas/r30/.generar`; sin esa señal se
 * saltea (no afirma nada de la pantalla: sirve igual sobre el árbol de antes y el de después). La etapa va en el
 * nombre: `ops/capturas/r30/.etapa` con el texto `antes` (o `CAPTURAS_ETAPA=antes`) = «antes»; si no, «despues».
 *
 * Datos ficticios: tres ofertas de «Empresa A» (evaluada alta, evaluada con un bloqueador y sin evaluar). Se
 * borran al terminar. Las capturas van a `ops/capturas/r30/` (no se versiona).
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r30");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(join(OUT, ".generar"));
const ETAPA_FILE = join(OUT, ".etapa");
const ETAPA =
  process.env.CAPTURAS_ETAPA === "antes" ||
  (existsSync(ETAPA_FILE) && readFileSync(ETAPA_FILE, "utf8").trim() === "antes")
    ? "antes"
    : "despues";
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;

test.describe.configure({ mode: "serial" });
test.skip(!SHOTS, "sin CAPTURAS=1 ni ops/capturas/r30/.generar");
test.setTimeout(120_000);

const created: string[] = [];
let alta = "";
let bloqueada = "";
let sinEvaluar = "";

test.beforeAll(async () => {
  alta = await createJob({
    title: "Analista de datos (captura R30)",
    status: "evaluada",
    jdText: "Aviso ficticio.",
  });
  await createEvaluation(alta, { score: 7.4, accion: "aplicar" });
  bloqueada = await createJob({
    title: "Analista contable (captura R30)",
    status: "evaluada",
    jdText: "Aviso ficticio.",
  });
  await createEvaluation(bloqueada, {
    score: 6.9,
    accion: "descartar",
    riesgos: ["many_candidates"],
  });
  sinEvaluar = await createJob({
    title: "Asistente administrativo (captura R30)",
    status: "pendiente_jd",
  });
  created.push(alta, bloqueada, sinEvaluar);
});

test.afterAll(async () => {
  for (const id of created) await deleteJob(id).catch(() => {});
});

async function shot(
  page: Page,
  name: string,
  width: number,
  theme: string,
  full = true,
): Promise<void> {
  await page.waitForLoadState("networkidle");
  await settleBrandMotion(page);
  // Las herramientas de desarrollo de Next no son parte de la app
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: join(OUT, `${name}-${width}-${theme}-${ETAPA}.png`),
    fullPage: full,
  });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`ofertas a ${width} px en ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      await login(page);

      await page.goto("/jobs");
      await shot(page, "01-listado", width, theme);
      await page.goto("/jobs?estado=descartada");
      await shot(page, "02-listado-descartadas", width, theme);
      await page.goto(`/jobs/${alta}`);
      await shot(page, "03-detalle-evaluada", width, theme);
      await page.goto(`/jobs/${bloqueada}`);
      await shot(page, "04-detalle-bloqueador", width, theme);
      await page.goto(`/jobs/${sinEvaluar}`);
      await shot(page, "05-detalle-sin-evaluar", width, theme);
    });
  }
}
