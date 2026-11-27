import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type Page } from "@playwright/test";
import { axeSummary, settleBrandMotion } from "./axe-helpers";
import { ensureSecondUser, loginAsSecondUser } from "./helpers";

/**
 * Flujo 440 (R34-01): auditoría de legibilidad de todas las pantallas de usuario, para la revisión de diseño.
 * Mismo método del 340 (R30-12) y del 431 (R33-10): Hoy, bandeja, postulaciones, Interview, Academy, plan,
 * configuración, ofertas, el alta, el asistente y las páginas públicas, en claro y oscuro, a 390 y a 1280 px y
 * con el zoom al 200 % (se emula con la mitad del ancho de ventana). Mide lo que calcula el navegador:
 * `tamano` (texto de menos de 12 px), `opacidad` (efectiva menor a 1), `color_transparente` (alfa menor a 1),
 * `contraste` (axe `color-contrast`) y `desborde` (la página se desplaza en horizontal).
 *
 * Solo corre con `AUDITORIA=1` o si existe `ops/capturas/r34/legibilidad/.generar`. De cada pantalla con
 * hallazgos deja una captura con lo que no cumple marcado en rojo y `resumen.md` (no se versiona).
 * Quedan afuera las pantallas con id en la ruta (detalle de oferta, Interview, bandeja) y el admin (plan §9).
 * Las pantallas de usuario las recorre la persona B (tester); las públicas, una visita sin sesión. No escribe en
 * la base: solo lee.
 */
const OUT = join(__dirname, "..", "..", "..", "ops", "capturas", "r34", "legibilidad");
const RUN = process.env.AUDITORIA === "1" || existsSync(join(OUT, ".generar"));
const THEMES = ["claro", "oscuro"] as const;
const WIDTHS = [390, 1280] as const;
const ZOOMS = [100, 200] as const;

test.describe.configure({ mode: "serial" });
test.skip(!RUN, "sin AUDITORIA=1 ni ops/capturas/r34/legibilidad/.generar");
test.setTimeout(600_000);

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
  await ensureSecondUser();
});

test.afterAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const total = filas.reduce(
    (n, f) => n + Object.values(f.porCodigo).reduce((a, b) => a + b, 0),
    0,
  );
  const lineas = [
    "# Auditoría de legibilidad · todas las pantallas de usuario (R34-01)",
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
  // Un archivo por corrida: la auditoría completa no entra en memoria de una vez con `next dev` y se corre por
  // partes (`-g`), así que cada parte deja el suyo sin pisar las anteriores.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  writeFileSync(join(OUT, `resumen-${stamp}.md`), lineas.join("\n"));
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

/** Pantallas de la persona (sesión de la B). Una que redirige se anota con la ruta donde terminó. */
const PANTALLAS_DE_USUARIO: [string, string][] = [
  ["hoy", "/hoy"],
  ["bandeja", "/inbox"],
  ["ofertas", "/jobs"],
  ["ofertas-nueva", "/jobs/new"],
  ["ofertas-pendientes", "/jobs/pending-jd"],
  ["postulaciones", "/applications"],
  ["interview", "/interview"],
  ["academy", "/academy"],
  ["plan", "/plan"],
  ["recorrido", "/recorrido"],
  ["encaje", "/encaje"],
  ["calibracion", "/calibracion"],
  ["mercado", "/market"],
  ["config", "/settings"],
  ["config-perfil", "/settings/perfil"],
  ["config-criterios", "/settings/criteria"],
  ["config-habilidades", "/settings/skills"],
  ["config-remitentes", "/settings/senders"],
  ["config-conexiones", "/settings/conexiones"],
  ["config-asistente", "/settings/asistente"],
  ["config-academy", "/settings/academy"],
  ["config-historial", "/settings/historial"],
  ["config-textos", "/settings/textos"],
  ["alta", "/onboarding"],
  ["alta-asistente", "/onboarding/asistente"],
  ["alta-ofertas", "/onboarding/ofertas"],
  ["alta-habilidades", "/onboarding/skills"],
  ["alta-cv", "/onboarding/cv"],
];

/** Páginas públicas, sin sesión. */
const PANTALLAS_PUBLICAS: [string, string][] = [
  ["pub-portada", "/"],
  ["pub-acceso", "/acceso"],
  ["pub-ayuda", "/ayuda"],
  ["pub-precios", "/precios"],
  ["pub-ofertas", "/ofertas"],
  ["pub-mercado", "/mercado"],
  ["pub-como-esta-hecho", "/como-esta-hecho"],
  ["pub-demo", "/demo"],
  ["pub-demo-contaduria", "/demo/contaduria"],
  ["pub-privacidad", "/legal/privacidad"],
  ["pub-terminos", "/legal/terminos"],
  ["pub-login", "/login"],
  ["pub-register", "/register"],
  ["pub-olvide-clave", "/forgot-password"],
  ["pub-en-how-its-built", "/en/how-its-built"],
];

async function recorrer(
  page: Page,
  pantallas: [string, string][],
  ancho: number,
  tema: string,
  zoom: number,
): Promise<void> {
  for (const [nombre, ruta] of pantallas) {
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
    const destino = new URL(page.url()).pathname;
    const etiqueta = destino === ruta ? nombre : `${nombre} (terminó en ${destino})`;
    await auditar(page, nombre, ancho, tema, zoom);
    if (etiqueta !== nombre) filas[filas.length - 1]!.pantalla = etiqueta;
  }
}

for (const tema of THEMES) {
  for (const ancho of WIDTHS) {
    for (const zoom of ZOOMS) {
      test(`usuario a ${ancho} px, zoom ${zoom} %, en ${tema}`, async ({ page }) => {
        // Zoom al 200 %: el diseño se ve como en una ventana de la mitad del ancho
        await page.setViewportSize({ width: Math.round((ancho * 100) / zoom), height: 844 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
        await loginAsSecondUser(page);
        await recorrer(page, PANTALLAS_DE_USUARIO, ancho, tema, zoom);
      });

      test(`público a ${ancho} px, zoom ${zoom} %, en ${tema}`, async ({ page }) => {
        await page.setViewportSize({ width: Math.round((ancho * 100) / zoom), height: 844 });
        await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
        await recorrer(page, PANTALLAS_PUBLICAS, ancho, tema, zoom);
      });
    }
  }
}
