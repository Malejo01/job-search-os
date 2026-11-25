import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser } from "@playwright/test";

/**
 * Flujo 273 (R28-01): LCP de la portada con y sin Afi. Lighthouse no está instalado, así que se mide con
 * `PerformanceObserver` de `largest-contentful-paint`, celular de 390 px, CPU x4 y red lenta (CDP), 5 corridas
 * y mediana. «Sin Afi» bloquea `/mascota/**` (la imagen no llega): sirve de línea base sin cambiar de build.
 *
 * Solo corre si existe `ops/rondas/r28-tanda/.medir-lcp` (o `MEDIR_LCP=1`); sin esa señal se saltea.
 * Deja el detalle en `ops/rondas/r28-tanda/lcp-medicion.json`. Con servidor de desarrollo el número
 * absoluto no vale: solo la diferencia entre las dos variantes, que es lo que se exige (tope de 200 ms).
 */
const DIR = join(__dirname, "..", "..", "..", "ops", "rondas", "r28-tanda");
const MEDIR = process.env.MEDIR_LCP === "1" || existsSync(join(DIR, ".medir-lcp"));
const CORRIDAS = 5;
/** Tope de lo que puede sumar Afi al LCP (ms). */
const TOPE_MS = 200;

test.skip(!MEDIR, "sin MEDIR_LCP=1 ni ops/rondas/r28-tanda/.medir-lcp");
test.setTimeout(240_000);

type Lcp = { ms: number; tag: string; url: string; fetchpriority: string };

async function medir(browser: Browser, conAfi: boolean): Promise<Lcp> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    if (!conAfi) await page.route("**/mascota/**", (route) => route.abort());
    await page.addInitScript(() => {
      const w = window as unknown as { __lcp?: Record<string, unknown> };
      new PerformanceObserver((lista) => {
        const e = lista.getEntries().at(-1) as
          (PerformanceEntry & { element?: Element | null; url?: string }) | undefined;
        if (!e) return;
        w.__lcp = {
          ms: e.startTime,
          tag: e.element?.tagName ?? "",
          url: e.url ?? "",
          fetchpriority: e.element?.getAttribute("fetchpriority") ?? "",
        };
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(2_500); // el LCP se cierra con la primera interacción o al pasar un rato
    await page.mouse.click(5, 5);
    const r = await page.evaluate(
      () => (window as unknown as { __lcp?: Record<string, unknown> }).__lcp,
    );
    expect(r, "el navegador reportó un LCP").toBeTruthy();
    return {
      ms: Number(r?.ms ?? 0),
      tag: String(r?.tag ?? ""),
      url: String(r?.url ?? ""),
      fetchpriority: String(r?.fetchpriority ?? ""),
    };
  } finally {
    await context.close();
  }
}

const mediana = (xs: number[]): number => {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)] ?? 0;
};

test("el LCP de la portada con Afi no empeora más de 200 ms", async ({ browser }) => {
  // Calentamiento: en desarrollo la primera visita compila la ruta
  await medir(browser, true);
  const con: Lcp[] = [];
  const sin: Lcp[] = [];
  for (let i = 0; i < CORRIDAS; i++) {
    con.push(await medir(browser, true));
    sin.push(await medir(browser, false));
  }
  const medianaCon = mediana(con.map((c) => c.ms));
  const medianaSin = mediana(sin.map((c) => c.ms));
  const diferencia = medianaCon - medianaSin;
  const resultado = {
    fecha: new Date().toISOString(),
    corridas: CORRIDAS,
    medianaConAfiMs: Math.round(medianaCon),
    medianaSinAfiMs: Math.round(medianaSin),
    diferenciaMs: Math.round(diferencia),
    elementoConAfi: con.map((c) => `${c.tag} ${c.url} fp=${c.fetchpriority}`),
    elementoSinAfi: sin.map((c) => `${c.tag} ${c.url}`),
    conAfi: con.map((c) => Math.round(c.ms)),
    sinAfi: sin.map((c) => Math.round(c.ms)),
  };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, "lcp-medicion.json"), JSON.stringify(resultado, null, 2));
  console.log(JSON.stringify(resultado));

  // Si el LCP es la imagen de Afi, tiene que llevar prioridad alta
  for (const c of con) {
    if (c.url.includes("/mascota/")) expect(c.fetchpriority).toBe("high");
  }
  // Comparación relativa (sirve también con `next dev`, que es lo que levanta `local.mjs e2e`)
  expect(diferencia, `Afi suma ${Math.round(diferencia)} ms al LCP`).toBeLessThanOrEqual(TOPE_MS);
});
