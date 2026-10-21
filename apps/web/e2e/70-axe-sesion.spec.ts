import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  createEvaluation,
  createInboundEmail,
  createJob,
  deleteInboundEmails,
  deleteJob,
  login,
} from "./helpers";

/**
 * Flujo 70 (ronda C-4): accesibilidad (axe, WCAG 2.0/2.1 A y AA) de las pantallas con sesión, con
 * el usuario seed y dos viewports por ruta. Mismo patrón que `61-axe-publicas.spec.ts`. Los datos
 * son inventados y se limpian al terminar.
 *
 * Fuera de este spec (queda para C-4b): el onboarding. Exige una persona que no lo terminó y
 * `ensureSecondUser` lo crea ya completo; hay que registrar una persona con invitación
 * (`personas/flow.ts`), que es un flujo largo y con su propia limpieza.
 */
// Sin modo serial: una ruta con violaciones no saltea las demás (cada test solo lee)

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

type Route = {
  label: string;
  /** Ruta fija, o función que la arma con los ids sembrados. */
  path: string | ((ids: Seeded) => string);
  /**
   * Reglas que se excluyen en esta ruta. Cada una lleva un comentario `// C-4: <motivo>`.
   * Hoy ninguna ruta excluye nada.
   */
  disableRules?: string[];
};

type Seeded = { jobId: string; emailId: string };

// `/settings/invitations` la ve cualquier persona logueada (sin ser admin muestra un estado
// vacío), así que entra en la lista sin condiciones. Si se suma una página bajo
// `app/(app)/settings/`, sumarla acá.
const ROUTES: Route[] = [
  { label: "/hoy", path: "/hoy" },
  { label: "/jobs", path: "/jobs" },
  { label: "/jobs/[id]", path: (ids) => `/jobs/${ids.jobId}` },
  { label: "/jobs/new", path: "/jobs/new" },
  { label: "/jobs/pending-jd", path: "/jobs/pending-jd" },
  { label: "/applications", path: "/applications" },
  { label: "/inbox", path: "/inbox" },
  { label: "/inbox/[id]", path: (ids) => `/inbox/${ids.emailId}` },
  { label: "/market", path: "/market" },
  { label: "/plan", path: "/plan" },
  { label: "/settings", path: "/settings" },
  { label: "/settings/asistente", path: "/settings/asistente" },
  { label: "/settings/criteria", path: "/settings/criteria" },
  { label: "/settings/invitations", path: "/settings/invitations" },
  { label: "/settings/perfil", path: "/settings/perfil" },
  { label: "/settings/senders", path: "/settings/senders" },
  { label: "/settings/skills", path: "/settings/skills" },
];

test.describe("Flujo 70: axe en las pantallas con sesión", () => {
  const tag = Date.now();
  const seeded: Seeded = { jobId: "", emailId: "" };

  test.beforeAll(async () => {
    seeded.jobId = await createJob({
      title: `Oferta Ficticia Axe ${tag}`,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo de accesibilidad.",
    });
    await createEvaluation(seeded.jobId, { score: 8, accion: "aplicar" });
    const email = await createInboundEmail({
      subject: `Email ficticio axe ${tag}`,
      text: "Cuerpo ficticio para el flujo de accesibilidad.",
    });
    seeded.emailId = email.id;
  });

  test.afterAll(async () => {
    await deleteJob(seeded.jobId).catch(() => {});
    await deleteInboundEmails(`Email ficticio axe ${tag}`).catch(() => {});
  });

  for (const viewport of VIEWPORTS) {
    test.describe(`viewport ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const route of ROUTES) {
        test(`${route.label}: sin violaciones de axe`, async ({ page }) => {
          await login(page);
          const path = typeof route.path === "function" ? route.path(seeded) : route.path;
          await page.goto(path);
          // Todas las pantallas tienen un h1; si alguna redirige, falla acá y no con axe en otra página
          await expect(page.locator("h1").first()).toBeVisible();
          await page.waitForLoadState("networkidle");

          let builder = new AxeBuilder({ page }).withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
          ]);
          if (route.disableRules?.length) builder = builder.disableRules(route.disableRules);
          const { violations } = await builder.analyze();
          // Regla, impacto y selectores; nunca el HTML entero
          const resumen = violations.map(
            (v) =>
              `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes
                .map((n) => n.target.join(" "))
                .join(" | ")}`,
          );
          expect(resumen, `Violaciones en ${route.label} a ${viewport.name}`).toEqual([]);
        });
      }
    });
  }
});
