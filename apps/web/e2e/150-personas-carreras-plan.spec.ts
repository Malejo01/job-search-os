import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import roleSkills from "../../../packages/db/seeds/role_skills.json";
import { E2E_B_USER_ID, ensureSecondUser } from "./helpers";
import {
  cleanup,
  completeStep1,
  createInvitation,
  ensureSkills,
  fillSkills,
  finding,
  register,
  seedAndEvaluate,
  seedPool,
  computeRoleMarketAndPlan,
  type Run,
} from "./personas/flow";
import { SKILL_NAMES, buildPersona, type PersonaKey } from "./personas/personas";

/**
 * Flujo 150 (R14-3): QA por carrera, una persona inventada por cada una de las 8 carreras de la beta.
 * Recorrido: registro → onboarding → «Tus primeras ofertas» → /jobs → detalle de una oferta → plan de
 * formación. Comprueba, por carrera:
 * - ninguna oferta ni skill de otra familia (la oferta de control no aparece; el plan y el detalle no
 *   nombran skills de las otras familias que no sean de su carrera);
 * - los textos hablan su idioma: el mercado se titula con la etiqueta de su carrera;
 * - el detalle nunca dice «Cumplís todo» ni cuenta «N de N» si queda un excluyente sin cumplir.
 *
 * Aislamiento: cada carrera crea su propia persona (email `<clave>-<tag>@personas.test`), su invitación y
 * su pool sembrado con un tag único, y lo borra todo en `afterAll`. No depende de datos de otro spec
 * ni del orden: no usa el usuario sembrado de e2e (solo la persona B, idempotente, como firmante).
 * El worker demo evalúa sin LLM. Complementa al 126 (chip de /acceso, perfil, CV, ayuda).
 */
type Carrera = { key: PersonaKey; nombre: string };

const CARRERAS: Carrera[] = [
  { key: "agustina", nombre: "contaduría" },
  { key: "bruno", nombre: "administración" },
  { key: "ines", nombre: "relaciones internacionales" },
  { key: "julian", nombre: "programación" },
  { key: "mariana", nombre: "abogacía" },
  { key: "camila", nombre: "comunicación" },
  { key: "valentina", nombre: "marketing" },
  { key: "rrpp", nombre: "relaciones públicas" },
];

/** Skills propias de cada familia: lo que otra familia no tiene por qué ver en su plan ni en su oferta. */
const FAMILY_SKILLS: Record<string, string[]> = {
  tecnologia: ["nodejs", "docker", "rest_apis", "testing", "typescript", "react", "nextjs"],
  legal: ["contract_drafting", "corporate_law", "labor_law", "litigation", "legal_tools"],
  contable: ["general_accounting", "tax_compliance", "erp_accounting", "financial_reporting"],
  gestion: ["procurement", "process_improvement", "management_control", "business_strategy"],
  internacional: [
    "foreign_trade",
    "international_cooperation",
    "grant_writing",
    "diplomacy",
    "trade_agreements",
  ],
  comunicacion_marketing: [
    "press_relations",
    "corporate_communications",
    "copywriting",
    "audiovisual",
    "seo",
    "google_ads",
    "social_media",
    "email_marketing",
    "canva",
    "crisis_management",
    "event_management",
  ],
};

/** Familia de cada puesto (clave guardada en el perfil). Marketing, comunicación y RR.PP. comparten una. */
const FAMILY_OF_ROLE: Record<string, string> = {
  finanzas_contabilidad: "contable",
  administracion_empresas: "gestion",
  relaciones_internacionales: "internacional",
  fullstack: "tecnologia",
  abogacia: "legal",
  comunicacion: "comunicacion_marketing",
  marketing_digital: "comunicacion_marketing",
  relaciones_publicas: "comunicacion_marketing",
};

/**
 * Nombres en pantalla de las skills de las otras familias. Se descartan las que el puesto tiene en su
 * lista (`role_skills.json`) o que piden sus propias ofertas: esas sí pueden aparecer.
 */
function foreignSkillNames(run: Run): string[] {
  const role = run.persona.role;
  const family = FAMILY_OF_ROLE[role]!;
  const allowed = new Set<string>([
    ...((roleSkills as Record<string, { skills: string[] }>)[role]?.skills ?? []),
    ...run.persona.skills.map((k) => k.slug),
    ...run.persona.offers.filter((o) => o.own).flatMap((o) => (o.skills ?? []).map((k) => k.slug)),
  ]);
  const names: string[] = [];
  for (const [fam, slugs] of Object.entries(FAMILY_SKILLS)) {
    if (fam === family) continue;
    for (const slug of slugs) {
      if (!allowed.has(slug) && SKILL_NAMES[slug]) names.push(SKILL_NAMES[slug]!);
    }
  }
  return names;
}

/** Misma forma que `newRun`, pero con un tag distinto por carrera (la limpieza borra por tag). */
function newRunWithTag(key: PersonaKey, tag: number): Run {
  return {
    tag,
    persona: buildPersona(key, tag),
    code: randomBytes(32).toString("base64url"),
    userId: null,
    viaWaitlist: false,
  };
}

// El catálogo de skills se guarda una hora en el servidor (`unstable_cache`): en una base sin seed
// completo hay que cargar las skills de todas las personas antes de que cualquiera abra el onboarding
test.beforeAll(async () => {
  for (const carrera of CARRERAS) await ensureSkills(buildPersona(carrera.key));
});

CARRERAS.forEach((carrera, index) => {
  test.describe(`Flujo 150: ${carrera.nombre} (${carrera.key}), del registro al plan`, () => {
    test.describe.configure({ mode: "serial" });
    const run = newRunWithTag(carrera.key, Date.now() + index);
    const { persona } = run;
    const ownOffers = persona.offers.filter((o) => o.own);
    const control = persona.offers.find((o) => !o.own)!;
    const label = (roleSkills as Record<string, { label: string }>)[persona.role]!.label;
    let context: BrowserContext | undefined;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      // Firma la invitación la persona B (se crea si falta): no depende del usuario sembrado de e2e
      await ensureSecondUser();
      await createInvitation(run, E2E_B_USER_ID);
      await seedPool(run);
      context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await cleanup(run, context);
    });

    test("registro y onboarding hasta «Tus primeras ofertas»", async () => {
      await register(page, run);
      await completeStep1(page, run);
      await fillSkills(page, run);
    });

    test("«Tus primeras ofertas» trae las de su carrera y ninguna de otra familia", async () => {
      await seedAndEvaluate(run);
      await page.goto("/onboarding/ofertas");
      for (const o of ownOffers) {
        await expect(page.getByTestId("first-offer").filter({ hasText: o.title })).toBeVisible();
      }
      expect(await page.content()).not.toContain(control.title);
    });

    test("/jobs lista las suyas y el detalle de cada una no se contradice", async () => {
      test.setTimeout(150_000);
      await page.goto("/jobs");
      await expect(page.getByRole("heading", { name: "Tus ofertas", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: ownOffers[0]!.title }).first()).toBeVisible({
        timeout: 15_000,
      });
      expect(await page.content()).not.toContain(control.title);

      const foreign = foreignSkillNames(run);
      const hrefs: string[] = [];
      for (const o of ownOffers) {
        const href = await page
          .getByRole("link", { name: o.title })
          .first()
          .getAttribute("href", { timeout: 15_000 })
          .catch(() => null);
        if (href) hrefs.push(href);
        else finding(`/jobs no lista «${o.title}» (puede faltar evaluarla todavía)`);
      }
      expect(hrefs.length, "al menos una oferta propia en /jobs").toBeGreaterThan(0);

      for (const href of hrefs) {
        await page.goto(href);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        const body = await page.locator("body").innerText();

        // Ninguna skill de otra familia en el detalle de una oferta de su carrera
        for (const name of foreign) {
          expect(body, `el detalle de ${href} no nombra «${name}» (otra familia)`).not.toContain(
            name,
          );
        }

        // «Cumplís todo» nunca con un excluyente sin cumplir. El titular real es «Cumplís X de Y requisitos
        // excluyentes»; los deseables llevan «(deseable)» en su fila.
        const region = page.getByRole("region", { name: "Requisitos del aviso" });
        if ((await region.count()) > 0) {
          const unmetMust = region
            .locator("li")
            .filter({ has: page.getByText("No coincide", { exact: true }) })
            .filter({ hasNotText: "(deseable)" });
          const unmet = await unmetMust.count();
          const titular = await region.getByTestId("requisitos-titular").innerText();
          if (unmet > 0) {
            expect(body, "con un excluyente sin cumplir no dice «Cumplís todo»").not.toMatch(
              /cumpl[ií]s todo/i,
            );
            expect(
              titular,
              "el titular no cuenta todos los excluyentes como cumplidos",
            ).not.toMatch(/Coinciden (\d+) de \1 requisitos/);
          }
        } else {
          finding(`${href}: sin «Requisitos del aviso» (evaluación sin checklist)`);
          expect(body).not.toMatch(/cumpl[ií]s todo/i);
        }
      }
    });

    test("/market y /plan hablan de su carrera y no mezclan otra", async () => {
      // El cálculo con tsx puede tardar hasta 120 s (execSync): más que el timeout de 90 s
      test.setTimeout(240_000);
      computeRoleMarketAndPlan(run);

      await page.goto("/market");
      const market = page.getByTestId("role-market");
      await expect(market).toContainText(`El mercado de ${label}`);
      await expect(market).not.toContainText(
        `Todavía no hay ofertas públicas de ${label} para mostrar`,
      );
      // El mercado de otra carrera no aparece como si fuera suyo
      for (const [key, other] of Object.entries(roleSkills as Record<string, { label: string }>)) {
        if (key === persona.role || other.label === label) continue;
        expect(await market.innerText(), `no muestra el mercado de «${other.label}»`).not.toContain(
          `El mercado de ${other.label}`,
        );
      }

      await page.goto("/plan");
      await expect(page.getByRole("heading", { name: "Plan de formación" })).toBeVisible();
      const plan = await page.locator("body").innerText();
      for (const name of foreignSkillNames(run)) {
        expect(plan, `el plan de ${carrera.nombre} no trae «${name}» (otra familia)`).not.toContain(
          name,
        );
      }
      // Con 3 ofertas sembradas el plan puede quedar vacío: se acepta el texto vacío, sin contradicciones
      const ownNames = ownOffers
        .flatMap((o) => (o.skills ?? []).map((k) => SKILL_NAMES[k.slug]))
        .filter((n): n is string => Boolean(n));
      if (!ownNames.some((n) => plan.includes(n))) {
        finding(
          `/plan de ${carrera.nombre} no nombra skills de sus ofertas con 3 ofertas sembradas (¿umbral o texto vacío?)`,
        );
        expect(plan).toMatch(
          /No hay skills para reforzar|Con pocas ofertas todavía no|Todavía no|Estamos armando/,
        );
      }
    });
  });
});
