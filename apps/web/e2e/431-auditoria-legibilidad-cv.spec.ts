import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { axeSummary, settleBrandMotion } from "./axe-helpers";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, ownerDb } from "./helpers";

/**
 * Flujo 431 (R33-10): auditoría de legibilidad de las pantallas del CV, para la revisión de diseño. Es el
 * mismo método del 340 (R30-12) aplicado a «Tu CV» (con diagnóstico, opciones y descargas), la entrada del
 * agente de perfil y el coach, y el chat de `/cv/armar` (inicio y charla), en claro y oscuro, a 390 y a 1280
 * px y con el zoom al 200 % (se emula con la mitad del ancho de ventana). Mide lo que calcula el navegador:
 * `tamano` (texto de menos de 12 px), `opacidad` (efectiva menor a 1), `color_transparente` (alfa menor a 1),
 * `contraste` (axe `color-contrast`) y `desborde` (la página se desplaza en horizontal).
 *
 * Solo corre con `AUDITORIA=1` o si existe `ops/capturas/r33/legibilidad/.generar`. De cada pantalla con
 * hallazgos deja una captura con lo que no cumple marcado en rojo y `resumen.md` (no se versiona).
 * No recorre la revisión «Esto es lo que entendí» ni la vista previa de la charla: llegar ahí exige
 * responder todas las preguntas; las reglas estáticas (`test/legibilidad.test.ts`) las miden en modo
 * estricto. Persona B (tester); datos ficticios que se borran al terminar.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r33", "legibilidad");
const RUN = process.env.AUDITORIA === "1" || existsSync(join(OUT, ".generar"));
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;
const ZOOMS = [100, 200] as const;

test.describe.configure({ mode: "serial" });
test.skip(!RUN, "sin AUDITORIA=1 ni ops/capturas/r33/legibilidad/.generar");
test.setTimeout(240_000);

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

async function cleanHistory() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.careerHistory).where(eq(s.careerHistory.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

// Cada caso abre la charla de `/cv/armar` y los inicios del día tienen tope (5): con 8 casos el tercero ya daba 429.
// Se borran antes de cada caso como en los specs 86 y 412 (llamadas `cv:%` y el borrador de la persona B).
async function cleanChat() {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.cvDrafts).where(eq(s.cvDrafts.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

test.beforeEach(async () => {
  await cleanChat();
});

test.beforeAll(async () => {
  await ensureSecondUser();
  await cleanHistory();
  const { db, close } = ownerDb();
  try {
    await db.insert(s.careerHistory).values([
      {
        userId: E2E_B_USER_ID,
        kind: "trabajo",
        organization: "Empresa A",
        title: "Analista de Pruebas",
        startMonth: "2022-03",
        bullets: ["Coordiné tareas del área administrativa"],
        sort: 0,
      },
      {
        userId: E2E_B_USER_ID,
        kind: "educacion",
        organization: "Instituto A",
        title: "Tecnicatura A",
        sort: 1,
      },
    ]);
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  await cleanHistory();
  await cleanChat();
  mkdirSync(OUT, { recursive: true });
  const total = filas.reduce(
    (n, f) => n + Object.values(f.porCodigo).reduce((a, b) => a + b, 0),
    0,
  );
  const lineas = [
    "# Auditoría de legibilidad · pantallas del CV (R33-10)",
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

const PANTALLAS: [string, string][] = [
  ["01-tu-cv", "/cv"],
  ["02-perfil-lectura", "/cv/perfil"],
  ["03-perfil-guia", "/cv/perfil/guia"],
  ["04-perfil-huecos", "/cv/perfil/huecos"],
  ["05-coach", "/cv/coach"],
  ["06-coach-charla", "/cv/coach/charla"],
  ["07-armar-inicio", "/cv/armar"],
];

for (const tema of THEMES) {
  for (const ancho of WIDTHS) {
    for (const zoom of ZOOMS) {
      test(`CV a ${ancho} px, zoom ${zoom} %, en ${tema}`, async ({ page }) => {
        // Zoom al 200 %: el diseño se ve como en una ventana de la mitad del ancho
        await page.setViewportSize({ width: Math.round((ancho * 100) / zoom), height: 844 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
        await loginAsSecondUser(page);
        for (const [nombre, ruta] of PANTALLAS) {
          const r = await page.goto(ruta);
          // Una ruta que no existe para la persona (flag apagado) no se audita: se anota
          if (!r || r.status() >= 400) {
            filas.push({
              pantalla: `${nombre} (HTTP ${r?.status() ?? "?"})`,
              ancho,
              tema,
              zoom,
              porCodigo: {},
              chicos12a13: 0,
              ejemplos: [],
              captura: null,
            });
            continue;
          }
          await auditar(page, nombre, ancho, tema, zoom);
        }
        // Chat de /cv/armar: la primera pregunta
        await page.goto("/cv/armar");
        const empezar = page.getByRole("button", { name: "Empezar" });
        if (await empezar.isVisible()) {
          await empezar.click();
          await page.getByLabel("Tu respuesta").waitFor();
          await auditar(page, "08-armar-charla", ancho, tema, zoom);
        }
      });
    }
  }
}
