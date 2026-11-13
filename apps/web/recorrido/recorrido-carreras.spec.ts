import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import catalog from "../../../packages/db/seeds/skills.json";
import { perfilPorEmail, type PerfilRecorrido } from "./perfiles";

/**
 * Recorrido por carreras (T-1). NO corre en el CI: vive fuera de `e2e/` y tiene su propia config
 * (`playwright.recorrido.config.ts`). Se lanza a mano con `pnpm recorrido <url>` (ver docs/OPERACION.md).
 *
 * Para cada cuenta de `ops/test-users-credenciales.json` (la que escribe `admin:test-users --create`):
 * inicia sesión, hace el onboarding con los datos de su perfil (`perfiles.ts`), carga skills, espera las
 * primeras ofertas y abre hasta 40 ofertas evaluadas. Guarda en `ops/recorrido-carreras/<fecha>/`
 * capturas a 390 y 1280 px y un JSON por cuenta con las ofertas vistas, las skills que pidieron y la
 * persona no tiene, y los tiempos de carga.
 *
 * SOLO LEE. No postula a nada ni marca estados: lo único que escribe en la app es el login y el
 * onboarding (perfil y skills de la propia cuenta de prueba). Nunca se hace click en «Postulé»,
 * «Descartar», «Guardar» una oferta ni en ningún botón de estado de una oferta, y no se abre otro
 * dominio que el de la URL dada (el resto de los pedidos se aborta).
 */
const ROOT = resolve(__dirname, "../../..");
const CREDENTIALS = resolve(ROOT, "ops/test-users-credenciales.json");
const MAX_OFFERS = 40;
const WAIT_FIRST_OFFERS_MS = 8 * 60_000;
const WAIT_EVALUATIONS_MS = 10 * 60_000;

type Account = { email: string; password: string };

function readAccounts(): Account[] {
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS, "utf8")) as {
      accounts?: Record<string, { password: string }>;
    };
    return Object.entries(data.accounts ?? {}).map(([email, v]) => ({
      email,
      password: v.password,
    }));
  } catch {
    return [];
  }
}

const today = new Date().toISOString().slice(0, 10);
const OUT = resolve(ROOT, "ops/recorrido-carreras", today);

type SkillRow = { slug: string; name: string; aliases?: string[] };
const CATALOG = catalog as SkillRow[];

/** Skills del catálogo que el texto nombra (por nombre o alias, como palabra entera). */
function skillsMentioned(texts: string[]): string[] {
  const hay = ` ${texts.join(" \n ").toLowerCase()} `;
  const found = new Set<string>();
  for (const k of CATALOG) {
    for (const label of [k.name, ...(k.aliases ?? [])]) {
      const needle = label.trim().toLowerCase();
      if (needle.length < 3) continue;
      const at = hay.indexOf(needle);
      if (at < 0) continue;
      const before = hay[at - 1] ?? " ";
      const after = hay[at + needle.length] ?? " ";
      if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) found.add(k.slug);
    }
  }
  return [...found];
}

async function ms<T>(timings: Record<string, number>, step: string, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    timings[step] = Date.now() - started;
  }
}

async function closePrivacyIfAny(page: Page): Promise<void> {
  const button = page.getByRole("dialog").getByRole("button", { name: "Entiendo y continúo" });
  if (await button.isVisible().catch(() => false)) await button.click();
}

async function login(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Contraseña").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await closePrivacyIfAny(page);
}

/** Paso 1, igual que `completeStep1` de los e2e de personas, sin acceso a la base. */
async function onboardingStep1(page: Page, p: PerfilRecorrido): Promise<void> {
  const group = page.getByRole("group", { name: p.roleGroup, exact: true });
  await group.locator(`input[name="targetRoles"][value="${p.role}"]`).check();
  await page.getByLabel(/País de residencia/).fill(p.country);
  await page.getByRole("option", { name: new RegExp(`\\(${p.country}\\)`) }).click();
  await page.getByLabel(/Tu nivel de inglés/).selectOption(p.cefr);
  await page.getByLabel(/Años de experiencia/).fill(p.years);
  await page.getByLabel(/Resumen de tu perfil/).fill(p.summary);
  await page.getByRole("checkbox", { name: "Remoto" }).check();
  await page.getByRole("button", { name: "Guardar y continuar" }).click();
  await page.waitForURL("**/onboarding/skills**");
}

/** Mis skills: niveles autodeclarados del perfil y «Guardar y seguir». */
async function onboardingSkills(page: Page, p: PerfilRecorrido): Promise<void> {
  const labels = [
    "nunca lo usé",
    "hice un tutorial o curso",
    "lo usé en un proyecto",
    "lo uso con soltura",
  ];
  for (const { slug, level } of p.skills) {
    const row = page.getByTestId(`skill-${slug}`);
    // Una skill que la pantalla no muestra para esa carrera se anota, no rompe el recorrido
    if ((await row.count()) === 0) continue;
    await row.getByLabel(labels[level]!, { exact: true }).check();
  }
  await page.getByRole("button", { name: "Guardar y seguir" }).click();
  await page.waitForURL("**/onboarding/ofertas**");
}

type Card = { href: string; title: string; seal: string | null; chipsMissing: string[] };

async function readCards(page: Page): Promise<Card[]> {
  return page.getByTestId("tarjeta-oferta").evaluateAll((nodes) =>
    nodes.map((n) => {
      const link = n.querySelector<HTMLAnchorElement>('a[href^="/jobs/"]');
      return {
        href: link?.getAttribute("href") ?? "",
        title: n.querySelector("p")?.textContent?.trim() ?? "",
        seal: n.querySelector("[data-seal]")?.getAttribute("data-seal") ?? null,
        chipsMissing: [...n.querySelectorAll('[data-testid="tarjeta-chips"] > *')]
          .filter((c) => /te falta/i.test(c.textContent ?? ""))
          .map((c) => (c.getAttribute("title") ?? c.textContent ?? "").trim()),
      };
    }),
  );
}

async function waitFor<T>(
  what: string,
  timeoutMs: number,
  poll: () => Promise<T | null>,
  everyMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await poll();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`se agotó la espera: ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

const accounts = readAccounts();

test.describe.configure({ mode: "serial" });

test.describe("recorrido por carreras (solo lectura)", () => {
  test("hay cuentas en ops/test-users-credenciales.json", () => {
    expect(
      accounts.length,
      "falta ops/test-users-credenciales.json: correr `pnpm admin:test-users --create --by <admin>` antes",
    ).toBeGreaterThan(0);
  });

  for (const account of accounts) {
    const perfil = perfilPorEmail(account.email);
    const id = account.email.split("@")[0]!;

    test(`${id}`, async ({ browser, baseURL }) => {
      test.skip(
        !perfil,
        `${id}: sin perfil de carrera (cuenta de auditoría u otra): no se recorre`,
      );
      const p = perfil!;
      test.setTimeout(30 * 60_000);
      mkdirSync(OUT, { recursive: true });
      const origin = new URL(baseURL!).origin;

      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      // Nunca otro dominio que el de la URL dada
      await context.route(
        (url) => !["http:", "https:"].includes(url.protocol) || url.origin === origin,
        (route) => route.continue(),
      );
      await context.route(
        (url) => ["http:", "https:"].includes(url.protocol) && url.origin !== origin,
        (route) => route.abort(),
      );
      const page = await context.newPage();
      const timings: Record<string, number> = {};
      const notas: string[] = [];

      try {
        await ms(timings, "login_ms", () => login(page, account));

        if (new URL(page.url()).pathname.startsWith("/onboarding")) {
          await ms(timings, "onboarding_paso1_ms", () => onboardingStep1(page, p));
          await ms(timings, "onboarding_skills_ms", () => onboardingSkills(page, p));
        } else {
          notas.push("la cuenta ya tenía el onboarding hecho: no se repite");
        }

        // Primeras ofertas: la asignación del pool corre en segundo plano al guardar el perfil
        const first = await ms(timings, "primeras_ofertas_ms", () =>
          waitFor("las primeras ofertas", WAIT_FIRST_OFFERS_MS, async () => {
            await page.goto("/jobs");
            const cards = await readCards(page);
            return cards.length > 0 ? cards : null;
          }),
        );
        notas.push(`primeras ofertas: ${first.length} tarjetas`);

        // Evaluaciones: se espera a que ninguna tarjeta siga en «pendiente» (o se agote el tiempo)
        const cards = await ms(timings, "evaluaciones_ms", async () => {
          try {
            return await waitFor("las evaluaciones", WAIT_EVALUATIONS_MS, async () => {
              await page.goto("/jobs");
              const now = await readCards(page);
              return now.some((c) => c.seal === "pendiente") ? null : now;
            });
          } catch {
            notas.push("se agotó la espera de evaluaciones: se recorren las que ya estaban listas");
            return readCards(page);
          }
        });

        // Capturas de la lista a 390 y 1280 px
        await page.goto("/jobs");
        await page.screenshot({ path: resolve(OUT, `${id}-390.png`), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: resolve(OUT, `${id}-1280.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });

        const evaluated = cards.filter((c) => c.href && c.seal !== "pendiente" && c.seal !== "sin");
        const tengo = new Set(p.skills.map((k) => k.slug));
        const ofertas: unknown[] = [];
        const pedidas = new Map<string, number>();

        for (const [i, card] of evaluated.slice(0, MAX_OFFERS).entries()) {
          const started = Date.now();
          // Solo navegación: abrir una oferta no cambia nada
          await page.goto(card.href);
          await expect(page.locator("h1")).toBeVisible();
          const loadMs = Date.now() - started;
          const main = page.locator("main");
          const text = await main.innerText();
          const sealLabel = await page
            .locator('[role="img"][aria-label*="untaje"]')
            .first()
            .getAttribute("aria-label")
            .catch(() => null);
          const score = sealLabel
            ? Number(/(\d+(?:[.,]\d+)?)/.exec(sealLabel)?.[1]?.replace(",", "."))
            : null;
          const veredicto = await page
            .locator('h2:has-text("Veredicto") + p')
            .first()
            .innerText()
            .catch(() => null);
          const items = async (testId: string) =>
            page
              .getByTestId(testId)
              .locator("li")
              .allInnerTexts()
              .catch(() => [] as string[]);
          const favor = await items("fit-favor");
          const falta = await items("fit-falta");
          const fuente = /Publicado en ([^\n·]+)/.exec(text)?.[1]?.trim() ?? null;

          const pedidasAca = skillsMentioned([...falta, ...card.chipsMissing]).filter(
            (s) => !tengo.has(s),
          );
          for (const s of pedidasAca) pedidas.set(s, (pedidas.get(s) ?? 0) + 1);
          ofertas.push({
            orden: i + 1,
            fuente,
            titulo: (await page.locator("h1").innerText()).trim(),
            puntaje: Number.isFinite(score) ? score : null,
            veredicto,
            motivos_a_favor: favor,
            requisitos_faltantes: falta,
            skills_que_faltan: pedidasAca,
            carga_ms: loadMs,
          });
          if (i === 0) {
            await page.screenshot({ path: resolve(OUT, `${id}-oferta-390.png`), fullPage: true });
            await page.setViewportSize({ width: 1280, height: 900 });
            await page.screenshot({ path: resolve(OUT, `${id}-oferta-1280.png`), fullPage: true });
            await page.setViewportSize({ width: 390, height: 844 });
          }
        }

        const resumen = {
          cuenta: id,
          carrera: p.role,
          experiencia_anios: p.years,
          fecha: today,
          url: origin,
          notas,
          tiempos_ms: timings,
          ofertas_en_lista: cards.length,
          ofertas_vistas: ofertas.length,
          skills_del_catalogo_pedidas_y_ausentes: [...pedidas]
            .sort((a, b) => b[1] - a[1])
            .map(([slug, ofertas]) => ({ slug, ofertas })),
          ofertas,
        };
        writeFileSync(resolve(OUT, `${id}.json`), `${JSON.stringify(resumen, null, 2)}\n`);
        expect(ofertas.length, "alguna oferta evaluada para abrir").toBeGreaterThan(0);
      } finally {
        await context.close();
      }
    });
  }
});
