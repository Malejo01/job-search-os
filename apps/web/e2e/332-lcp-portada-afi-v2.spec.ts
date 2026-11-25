import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser } from "@playwright/test";

/**
 * Flujo 332 (R29-08): LCP de la portada con Afi v2, igual o mejor que en la R28. Misma medición que el 273:
 * `PerformanceObserver` de `largest-contentful-paint`, celular de 390 px, CPU x4 y red lenta (CDP), 5 corridas y
 * mediana, con y sin Afi (se bloquea `/mascota/**`). Lo que se compara es la diferencia «con Afi menos sin Afi»,
 * porque el número absoluto con `next dev` no vale. El resultado de la R28 está en
 * `ops/rondas/r28-tanda/lcp-medicion.json` (no se pisa); este deja el suyo en `ops/rondas/r29-tanda/r29-08/`.
 *
 * Solo corre si existe `ops/rondas/r29-tanda/r29-08/.medir-lcp` (o `MEDIR_LCP=1`); sin esa señal se saltea.
 */
const DIR = join(__dirname, "..", "..", "..", "ops", "rondas", "r29-tanda", "r29-08");
const R28 = join(__dirname, "..", "..", "..", "ops", "rondas", "r28-tanda", "lcp-medicion.json");
const MEDIR = process.env.MEDIR_LCP === "1" || existsSync(join(DIR, ".medir-lcp"));
const CORRIDAS = 5;
/** Tope de lo que puede sumar Afi al LCP (ms): el mismo de la R28. */
const TOPE_MS = 200;
/** Margen sobre la diferencia de la R28 (ms): el ruido de una máquina de desarrollo es de este orden. */
const MARGEN_VS_R28_MS = 150;

test.skip(!MEDIR, "sin MEDIR_LCP=1 ni ops/rondas/r29-tanda/r29-08/.medir-lcp");
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

test("el LCP de la portada con Afi v2 es igual o mejor que en la R28", async ({ browser }) => {
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
  let diferenciaR28: number | null;
  try {
    diferenciaR28 = Number(JSON.parse(readFileSync(R28, "utf8")).diferenciaMs);
  } catch {
    diferenciaR28 = null;
  }
  const resultado = {
    fecha: new Date().toISOString(),
    corridas: CORRIDAS,
    medianaConAfiMs: Math.round(medianaCon),
    medianaSinAfiMs: Math.round(medianaSin),
    diferenciaMs: Math.round(diferencia),
    diferenciaR28Ms: diferenciaR28,
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
  expect(diferencia, `Afi suma ${Math.round(diferencia)} ms al LCP`).toBeLessThanOrEqual(TOPE_MS);
  if (diferenciaR28 !== null) {
    expect(
      diferencia,
      `la R28 sumaba ${diferenciaR28} ms; ahora ${Math.round(diferencia)} ms`,
    ).toBeLessThanOrEqual(diferenciaR28 + MARGEN_VS_R28_MS);
  }
});
