import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { axeSummary, settleBrandMotion } from "./axe-helpers";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 340 (R30-12): auditoría de legibilidad de las pantallas de ofertas, para la revisión de diseño. Recorre el
 * listado, las descartadas y tres detalles (evaluada, con un riesgo y sin evaluar) en claro y oscuro, a 390 y a
 * 1280 px, y con el zoom al 200 % (se emula con un ancho de ventana de la mitad: el diseño se acomoda igual que
 * con el zoom del navegador). En cada pantalla mide lo que el navegador calcula:
 *
 * - `tamano`: un texto visible de menos de 12 px;
 * - `opacidad`: un texto con la opacidad efectiva (la suya y la de sus ancestros) menor a 1;
 * - `color_transparente`: un texto con el canal alfa del color menor a 1;
 * - `contraste`: lo que axe marca como `color-contrast`;
 * - `desborde`: la página se desplaza en horizontal (solo informativo al 200 %).
 *
 * También cuenta los textos de 12 a 13 px, que solo se aceptan para metadatos (revisión de diseño).
 *
 * Solo corre con `AUDITORIA=1` o si existe `ops/capturas/r30/legibilidad/.generar`; sin esa señal se saltea (es una
 * auditoría, no una afirmación del producto). De cada pantalla con hallazgos deja una captura con los elementos
 * marcados en rojo y al final `resumen.md`, todo en `ops/capturas/r30/legibilidad/` (no se versiona). Datos
 * ficticios de «Empresa A»; se borran al terminar. El resumen va al informe de la tanda.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r30", "legibilidad");
const RUN = process.env.AUDITORIA === "1" || existsSync(join(OUT, ".generar"));
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;
const ZOOMS = [100, 200] as const;

test.describe.configure({ mode: "serial" });
test.skip(!RUN, "sin AUDITORIA=1 ni ops/capturas/r30/legibilidad/.generar");
test.setTimeout(180_000);

const created: string[] = [];
let alta = "";
let conRiesgo = "";
let sinEvaluar = "";

type Hallazgo = { codigo: string; elemento: string; detalle: string };
type Fila = {
  pantalla: string;
  ancho: number;
  tema: string;
  zoom: number;
  porCodigo: Record<string, number>;
  chicos12a13: number;
  ejemplos: Hallazgo[];
  captura: string | null;
};
const filas: Fila[] = [];

test.beforeAll(async () => {
  alta = await createJob({
    title: "Analista de datos (auditoría R30)",
    status: "evaluada",
    jdText: "Aviso ficticio de Empresa A.",
  });
  await createEvaluation(alta, { score: 7.4, accion: "aplicar" });
  conRiesgo = await createJob({
    title: "Analista contable (auditoría R30)",
    status: "evaluada",
    jdText: "Aviso ficticio de Empresa A.",
  });
  await createEvaluation(conRiesgo, {
    score: 6.9,
    accion: "descartar",
    riesgos: ["many_candidates"],
  });
  sinEvaluar = await createJob({
    title: "Asistente administrativo (auditoría R30)",
    status: "pendiente_jd",
  });
  created.push(alta, conRiesgo, sinEvaluar);
});

test.afterAll(async () => {
  for (const id of created) await deleteJob(id).catch(() => {});
  mkdirSync(OUT, { recursive: true });
  const total = filas.reduce(
    (n, f) => n + Object.values(f.porCodigo).reduce((a, b) => a + b, 0),
    0,
  );
  const lineas = [
    "# Auditoría de legibilidad · pantallas de ofertas (R30-12)",
    "",
    `Generada el ${new Date().toISOString().slice(0, 10)}. Hallazgos en total: ${total}.`,
    "Mide en el navegador: texto menor a 12 px, opacidad o alfa menor a 1 en un texto, contraste (axe) y desborde horizontal. El zoom al 200 % se emula con la mitad del ancho de ventana.",
    "",
    "| Pantalla | Ancho | Tema | Zoom | Tamaño < 12 px | Opacidad | Color transparente | Contraste | Desborde | Textos de 12 a 13 px | Captura |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...filas.map(
      (f) =>
        `| ${f.pantalla} | ${f.ancho} | ${f.tema} | ${f.zoom} % | ${f.porCodigo.tamano ?? 0} | ${f.porCodigo.opacidad ?? 0} | ${f.porCodigo.color_transparente ?? 0} | ${f.porCodigo.contraste ?? 0} | ${f.porCodigo.desborde ?? 0} | ${f.chicos12a13} | ${f.captura ?? "—"} |`,
    ),
    "",
    "## Ejemplos por pantalla (hasta 12 por fila)",
    "",
    ...filas
      .filter((f) => f.ejemplos.length)
      .flatMap((f) => [
        `### ${f.pantalla} · ${f.ancho} px · ${f.tema} · ${f.zoom} %`,
        ...f.ejemplos.slice(0, 12).map((e) => `- \`${e.codigo}\` ${e.elemento}: ${e.detalle}`),
        "",
      ]),
  ];
  writeFileSync(join(OUT, "resumen.md"), lineas.join("\n"));
});

/** Mide en la página y marca en rojo lo que no cumple. Se evalúa dentro del navegador. */
async function medir(page: Page): Promise<{
  hallazgos: Hallazgo[];
  chicos12a13: number;
  desborde: boolean;
}> {
  return page.evaluate(() => {
    const hallazgos: { codigo: string; elemento: string; detalle: string }[] = [];
    let chicos12a13 = 0;
    const describir = (el: Element) => {
      const clase = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 4).join(".");
      return `${el.tagName.toLowerCase()}${clase ? "." + clase : ""}`;
    };
    const opacidadEfectiva = (el: Element | null): number => {
      let o = 1;
      for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    };
    const ocultoParaTodos = (el: Element, css: CSSStyleDeclaration) => {
      if (css.display === "none" || css.visibility === "hidden") return true;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) return true; // sr-only
      return !!el.closest("nextjs-portal, script, style, noscript");
    };
    const marcar = (el: Element) => {
      (el as HTMLElement).style.outline = "2px solid #e11d48";
      (el as HTMLElement).style.outlineOffset = "1px";
    };
    const vistos = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const texto = (node.textContent ?? "").trim();
      const el = node.parentElement;
      if (!texto || !el || vistos.has(el)) continue;
      vistos.add(el);
      const css = getComputedStyle(el);
      if (ocultoParaTodos(el, css)) continue;
      const px = parseFloat(css.fontSize);
      const op = opacidadEfectiva(el);
      const alfa = /rgba?\(([^)]+)\)/.exec(css.color)?.[1]?.split(/[\s,/]+/)[3];
      const snippet = texto.slice(0, 40);
      if (px < 12) {
        hallazgos.push({
          codigo: "tamano",
          elemento: describir(el),
          detalle: `${px} px · «${snippet}»`,
        });
        marcar(el);
      } else if (px < 14) {
        chicos12a13++;
      }
      if (op < 1 && op > 0) {
        hallazgos.push({
          codigo: "opacidad",
          elemento: describir(el),
          detalle: `opacidad ${op.toFixed(2)} · «${snippet}»`,
        });
        marcar(el);
      }
      if (alfa !== undefined && Number(alfa) < 1 && Number(alfa) > 0) {
        hallazgos.push({
          codigo: "color_transparente",
          elemento: describir(el),
          detalle: `alfa ${alfa} · «${snippet}»`,
        });
        marcar(el);
      }
    }
    const desborde =
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    if (desborde) {
      // Los elementos que se pasan del ancho de la ventana (los más anchos primero), para saber cuál es
      const ancho = document.documentElement.clientWidth;
      const pasados = Array.from(document.body.querySelectorAll("*"))
        .filter((el) => !el.closest("nextjs-portal"))
        .map((el) => ({ el, derecha: el.getBoundingClientRect().right }))
        .filter((x) => x.derecha > ancho + 1)
        .sort((a, b) => b.derecha - a.derecha)
        .slice(0, 5);
      for (const { el, derecha } of pasados) {
        hallazgos.push({
          codigo: "desborde_elemento",
          elemento: describir(el),
          detalle: `termina en ${Math.round(derecha)} px, la ventana mide ${ancho} px`,
        });
        marcar(el);
      }
    }
    return { hallazgos, chicos12a13, desborde };
  });
}

async function auditar(
  page: Page,
  pantalla: string,
  ancho: number,
  tema: string,
  zoom: number,
): Promise<void> {
  await page.waitForLoadState("networkidle");
  await settleBrandMotion(page);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const axe = await axeSummary(page);
  const contraste = axe.violations.filter((v) => v.startsWith("color-contrast"));
  const { hallazgos, chicos12a13, desborde } = await medir(page);
  for (const v of contraste)
    hallazgos.push({ codigo: "contraste", elemento: "axe", detalle: v.slice(0, 200) });
  if (desborde)
    hallazgos.push({ codigo: "desborde", elemento: "html", detalle: "se desplaza en horizontal" });

  const porCodigo: Record<string, number> = {};
  for (const h of hallazgos) porCodigo[h.codigo] = (porCodigo[h.codigo] ?? 0) + 1;
  let captura: string | null = null;
  if (hallazgos.length) {
    mkdirSync(OUT, { recursive: true });
    captura = `${pantalla}-${ancho}-${tema}-z${zoom}.png`;
    await page.screenshot({ path: join(OUT, captura), fullPage: true });
  }
  filas.push({ pantalla, ancho, tema, zoom, porCodigo, chicos12a13, ejemplos: hallazgos, captura });
}

for (const tema of THEMES) {
  for (const ancho of WIDTHS) {
    for (const zoom of ZOOMS) {
      test(`ofertas a ${ancho} px, zoom ${zoom} %, en ${tema}`, async ({ page }) => {
        // Zoom al 200 %: el diseño se ve como en una ventana de la mitad del ancho
        await page.setViewportSize({ width: Math.round((ancho * 100) / zoom), height: 844 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
        await login(page);

        const pantallas: [string, string][] = [
          ["01-listado", "/jobs"],
          ["02-descartadas", "/jobs?estado=descartada"],
          ["03-detalle-evaluada", `/jobs/${alta}`],
          ["04-detalle-con-riesgo", `/jobs/${conRiesgo}`],
          ["05-detalle-sin-evaluar", `/jobs/${sinEvaluar}`],
        ];
        for (const [nombre, ruta] of pantallas) {
          await page.goto(ruta);
          await auditar(page, nombre, ancho, tema, zoom);
        }
      });
    }
  }
}
