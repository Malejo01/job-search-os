import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { and, eq, like } from "drizzle-orm";
import { settleBrandMotion } from "./axe-helpers";
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
 * Flujo 300 (R28-09): galería de capturas y medición a 360×640 (celular chico). Recorre las pantallas
 * públicas y las de la persona B (ficticia, solo en la base local) y, por pantalla, mide:
 *   - scroll horizontal y los elementos que se pasan del borde derecho;
 *   - controles tocables de menos de 44 px (botones, links fuera de un párrafo, campos, resúmenes);
 *   - texto cortado (overflow oculto sin puntos suspensivos).
 * La medición no falla el test (es el insumo del informe); sí falla si la pantalla no carga. Con
 * `ops/capturas/r28/360/.generar` presente guarda las capturas en `ops/capturas/r28/360/<fase>/` y el
 * informe de medición en `ops/rondas/r28-tanda/r28-09/medicion-<fase>.md`. La fase («antes» o
 * «despues») sale del contenido de `.generar` (por omisión «antes»). La carpeta de capturas no se versiona.
 *
 * Corre en serie y usa la persona B: no correrlo junto con los flujos 180 a 182, 186 ni 200.
 */
const ROOT = join(__dirname, "..", "..", "..", "ops");
const OUT_BASE = join(ROOT, "capturas", "r28", "360");
const MARK = join(OUT_BASE, ".generar");
const SHOTS = process.env.CAPTURAS === "1" || existsSync(MARK);
const FASE =
  (existsSync(MARK) ? readFileSync(MARK, "utf8").trim() : "") === "despues" ? "despues" : "antes";
const OUT = join(OUT_BASE, FASE);

const TAG = `300-${Date.now()}`;

test.describe.configure({ mode: "serial" });
test.use({
  viewport: { width: 360, height: 640 },
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
  permissions: ["microphone"],
});
// `next dev` compila cada ruta la primera vez: la pasada por 30 pantallas necesita margen
test.setTimeout(420_000);

type Finding = { screen: string; kind: string; detail: string };
const FINDINGS: Finding[] = [];
const SCREENS: { screen: string; status: number }[] = [];

type Measure = {
  scrollWidth: number;
  innerWidth: number;
  overflowing: string[];
  small: string[];
  clipped: string[];
};

/** Se corre dentro de la página. Describe cada elemento con una etiqueta corta (sin textos largos). */
async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const describe = (el: Element): string => {
      const h = el as HTMLElement;
      const id = h.getAttribute("data-testid");
      const label = (h.getAttribute("aria-label") ?? h.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""}${label ? ` «${label.slice(0, 40)}»` : ""}`;
    };
    const shown = (el: HTMLElement): DOMRect | null => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return null;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || Number(st.opacity) === 0) return null;
      if (el.closest("nextjs-portal,[aria-hidden='true'],[hidden],[inert]")) return null;
      return r;
    };
    const innerWidth = window.innerWidth;
    const overflowing: string[] = [];
    const small: string[] = [];
    const clipped: string[] = [];
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));

    // 1. Se pasan del borde derecho: primero el filtro barato por rect; recién ahí se mira a los ancestros
    const scrollsMemo = new Map<Element, boolean>();
    const clipsX = (p: Element): boolean => {
      let v = scrollsMemo.get(p);
      if (v === undefined) {
        const ox = getComputedStyle(p).overflowX;
        v =
          p !== document.body &&
          p !== document.documentElement &&
          (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip");
        scrollsMemo.set(p, v);
      }
      return v;
    };
    for (const el of all) {
      if (overflowing.length >= 8) break;
      if (el.getBoundingClientRect().right <= innerWidth + 1) continue;
      const r = shown(el);
      if (!r) continue;
      let scrolls = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (clipsX(p)) {
          scrolls = true;
          break;
        }
      }
      if (!scrolls) overflowing.push(`${describe(el)} → ${Math.round(r.right)} px`);
    }

    // 2. Controles tocables de menos de 44 px: solo los elementos tocables
    const tappables = document.querySelectorAll<HTMLElement>(
      "a[href], button, select, textarea, summary, [role=button], input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
    );
    for (const el of Array.from(tappables)) {
      if (el.tagName === "A" && el.closest("p")) continue;
      // Un link dentro de una oración (el elemento padre tiene texto propio) es «en línea»: WCAG 2.5.8 lo exime
      if (
        el.tagName === "A" &&
        el.parentElement &&
        Array.from(el.parentElement.childNodes).some(
          (n) =>
            n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").replace(/[\s.·,;:]/g, "") !== "",
        )
      ) {
        continue;
      }
      const r = shown(el);
      if (r && (r.height < 43.5 || r.width < 43.5)) {
        small.push(`${describe(el)} → ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }

    // 3. Texto cortado: primero el filtro barato (scrollWidth > clientWidth) y recién ahí el estilo
    for (const el of all) {
      if (clipped.length >= 8) break;
      if (el.children.length !== 0 || el.scrollWidth <= el.clientWidth + 2) continue;
      const st = getComputedStyle(el);
      if (
        (st.overflowX === "hidden" || st.overflowX === "clip") &&
        st.textOverflow !== "ellipsis" &&
        (el.textContent ?? "").trim().length > 0 &&
        shown(el)
      ) {
        clipped.push(`${describe(el)} → ${el.scrollWidth} > ${el.clientWidth}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      overflowing: overflowing.slice(0, 8),
      small: small.slice(0, 40),
      clipped: clipped.slice(0, 8),
    };
  });
}

async function hideDevChrome(page: Page): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

/** Esconde lo fijo en la captura de página entera (se ve aparte en la de ventana). */
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

async function shot(page: Page, name: string, status: number): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading").first(), name).toBeVisible();
  await expect(page.locator("body"), name).not.toContainText("Application error");
  await hideDevChrome(page);
  await settleBrandMotion(page);
  SCREENS.push({ screen: name, status });
  const m = await measure(page);
  if (m.scrollWidth > m.innerWidth) {
    FINDINGS.push({
      screen: name,
      kind: "scroll horizontal",
      detail: `${m.scrollWidth} > ${m.innerWidth}`,
    });
  }
  for (const d of m.overflowing)
    FINDINGS.push({ screen: name, kind: "se pasa del borde", detail: d });
  for (const d of m.small) FINDINGS.push({ screen: name, kind: "menos de 44 px", detail: d });
  for (const d of m.clipped) FINDINGS.push({ screen: name, kind: "texto cortado", detail: d });
  if (!SHOTS) return;
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(OUT, `${name}-ventana-360.png`) });
  const restore = await hideFixedBars(page);
  try {
    await page.screenshot({ path: join(OUT, `${name}-360.png`), fullPage: true });
  } finally {
    await restore();
  }
}

async function visit(page: Page, name: string, path: string): Promise<void> {
  const res = await page.goto(path);
  await shot(page, name, res?.status() ?? 0);
}

function writeReport(): void {
  if (!SHOTS) return;
  const dir = join(ROOT, "rondas", "r28-tanda", "r28-09");
  mkdirSync(dir, { recursive: true });
  const byKind = new Map<string, number>();
  for (const f of FINDINGS) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  const lines = [
    `# Medición a 360×640 · fase «${FASE}» (R28-09)`,
    "",
    `Generado por \`e2e/300-celular-360.spec.ts\`. Pantallas: ${SCREENS.length}. Hallazgos: ${FINDINGS.length} (${[...byKind].map(([k, n]) => `${k}: ${n}`).join(", ") || "ninguno"}).`,
    "",
    "## Pantallas",
    ...SCREENS.map((x) => `- ${x.screen} (HTTP ${x.status})`),
    "",
    "## Hallazgos",
    "",
    "| Pantalla | Tipo | Detalle |",
    "| --- | --- | --- |",
    ...(FINDINGS.length
      ? FINDINGS.map((f) => `| ${f.screen} | ${f.kind} | ${f.detail.replace(/\|/g, "/")} |`)
      : ["| (ninguno) | | |"]),
    "",
  ];
  writeFileSync(join(dir, `medicion-${FASE}.md`), lines.join("\n"));
}

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

let base: SecondUserData | null = null;

test.afterAll(async () => {
  writeReport();
  await cleanInterview();
  const { db, close } = ownerDb();
  try {
    await db.delete(s.candidateFacts).where(eq(s.candidateFacts.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
  await removeSecondUser();
});

test("pantallas públicas a 360 px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jso-tema", "claro"));
  for (const [name, path] of [
    ["01-portada", "/"],
    ["02-acceso", "/acceso"],
    ["03-login", "/login"],
    ["04-register", "/register"],
    ["05-precios", "/precios"],
    ["06-ayuda", "/ayuda"],
    ["07-demo", "/demo"],
    ["08-ofertas", "/ofertas"],
    ["09-mercado", "/mercado"],
    ["10-terminos", "/legal/terminos"],
  ] as const) {
    await visit(page, name, path);
  }
});

test.describe("con sesión", () => {
  test.beforeAll(async () => {
    await ensureSecondUser();
    await cleanInterview();
    base = await seedSecondUserData(TAG);
  });

  test("pantallas de la app a 360 px", async ({ page }) => {
    const g = base!;
    await page.addInitScript(() => localStorage.setItem("jso-tema", "claro"));
    await loginAsSecondUser(page);
    // Una simulación en curso para la pantalla de la pregunta
    const { db, close } = ownerDb();
    let sessionId: string | undefined;
    try {
      const [row] = await db
        .insert(s.interviewSessions)
        .values({
          userId: E2E_B_USER_ID,
          sourceKind: "job",
          jobId: g.jobId,
          title: "Oferta Ficticia B · Empresa B",
          questions: [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de la simulación`),
        })
        .returning({ id: s.interviewSessions.id });
      sessionId = row!.id;
    } finally {
      await close();
    }
    for (const [name, path] of [
      ["20-hoy", "/hoy"],
      ["21-match", "/jobs?estado=todas"],
      ["22-oferta", `/jobs/${g.jobId}`],
      ["23-preparar", `/jobs/${g.jobId}/postular`],
      ["24-cargar-oferta", "/jobs/new"],
      ["25-cv", "/cv"],
      ["26-cv-armar", "/cv/armar"],
      ["27-cv-coach", "/cv/coach"],
      ["28-cv-perfil", "/cv/perfil"],
      ["29-tracker", "/applications"],
      ["30-encaje", "/encaje"],
      ["31-interview", "/interview"],
      ["32-interview-pregunta", `/interview/${sessionId}`],
      ["33-academy", "/academy"],
      ["34-inbox", "/inbox"],
      ["35-ajustes", "/settings"],
      ["36-ajustes-perfil", "/settings/perfil"],
      ["37-ajustes-criterios", "/settings/criteria"],
      ["38-plan", "/plan"],
      ["39-mercado", "/market"],
    ] as const) {
      await visit(page, name, path);
    }
    await cleanInterview();
  });

  test("recorrido de primer uso a 360 px", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("jso-tema", "claro"));
    await page.addInitScript(() => localStorage.setItem("jso-primer-uso-forzar", "1"));
    await loginAsSecondUser(page);
    const dialog = page.getByTestId("primer-uso");
    await expect(dialog).toBeVisible();
    await shot(page, "40-primer-uso-paso1", 200);
    for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Siguiente" }).click();
    await shot(page, "41-primer-uso-paso4", 200);
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
