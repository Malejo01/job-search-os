import { describe, expect, it } from "vitest";
import taxonomy from "../../../db/seeds/skills.json";
import { compileTaxonomy, extractJdSkills, extractSkillsFromText } from "./match";
import {
  SOURCE_CATEGORY_ROLES,
  inferRoleHints,
  matchesRoleTitle,
  normalizeTitleText,
} from "./role-hints";
import { ROLE_KEYS, type RoleKey } from "./self-assessment";

/**
 * R11-9: medición antes/después sobre avisos inventados que reproducen cada caso de la auditoría.
 * No toca ninguna base: el pool real está en producción (vedada) y su número lo corre el dueño con
 * `pnpm skills:extract --pool` (dry-run) y `pnpm pool:rehint` (dry-run). Corrida con salida:
 *   pnpm --filter @job-search-os/pipeline exec vitest run src/skills/medicion-r11-9.test.ts
 * Los avisos son fragmentos inventados con empresas ficticias.
 */

const terms = compileTaxonomy(taxonomy);

type Aviso = {
  id: string;
  title: string;
  sourceKind: string;
  category: string;
  /** Carrera a la que el aviso de verdad pertenece; null = ninguna de las 8 de la beta. */
  career: RoleKey | null;
  text: string;
  /** Skills que el texto de verdad nombra. Todo lo demás que se detecte es espurio. */
  named: string[];
};

const MF = "remote-management-and-finance-jobs";

const AVISOS: Aviso[] = [
  // ── Las 8 carreras de la beta: un aviso propio de cada una ──
  {
    id: "abogacia",
    title: "Abogado/a de propiedad intelectual",
    sourceKind: "jobicy",
    category: "legal",
    career: "abogacia",
    text: "Empresa A busca abogado/a especializado en propiedad intelectual: registro de marcas y patentes, contratos de licencia y litigios.",
    named: ["ip_law", "litigation"],
  },
  {
    id: "contaduria",
    title: "Staff Accountant",
    sourceKind: "wwr",
    category: MF,
    career: "finanzas_contabilidad",
    text: "Empresa B needs a Staff Accountant. Month-end close, general ledger, bookkeeping in QuickBooks. Company growth is strong and our brand identity is warm.",
    named: ["general_accounting", "erp_accounting"],
  },
  {
    id: "administracion",
    title: "Analista de compras",
    sourceKind: "jobicy",
    category: "management",
    career: "administracion_empresas",
    text: "Empresa C: gestión de compras y proveedores, órdenes de compra y licitaciones. Excel avanzado.",
    named: ["procurement", "excel"],
  },
  {
    id: "comunicacion",
    title: "Periodista digital",
    sourceKind: "jobicy",
    category: "copywriting",
    career: "comunicacion",
    text: "Empresa D busca periodista digital: redacción periodística, fact checking y edición de notas. Comunicados de prensa.",
    named: ["journalism", "press_relations"],
  },
  {
    id: "marketing",
    title: "Performance Marketing Manager",
    sourceKind: "wwr",
    category: "remote-sales-and-marketing-jobs",
    career: "marketing_digital",
    text: "Empresa E: growth marketing, paid media en Google Ads y Meta Ads, funnels y A/B tests. Medís en GA4.",
    named: ["growth_marketing", "google_ads", "meta_ads", "ga4"],
  },
  {
    id: "rrpp",
    title: "Ejecutivo/a de RR.PP.",
    sourceKind: "greenhouse",
    category: "",
    career: "relaciones_publicas",
    text: "Empresa F: relaciones con la prensa, comunicados de prensa, eventos corporativos y manejo de crisis.",
    named: ["press_relations", "event_management", "crisis_management"],
  },
  {
    id: "rrii",
    title: "Analista de comercio exterior",
    sourceKind: "greenhouse",
    category: "",
    career: "relaciones_internacionales",
    text: "Empresa G: comercio exterior, despachante de aduana, importaciones y exportaciones, incoterms.",
    named: ["foreign_trade"],
  },
  {
    id: "programacion",
    title: "Full Stack Engineer",
    sourceKind: "wwr",
    category: "remote-full-stack-programming-jobs",
    career: "fullstack",
    text: "Empresa H: TypeScript, React, Next.js y Node. We are a distributed team; make sure tests pass. Go above and beyond.",
    named: ["typescript", "react", "nextjs", "nodejs"],
  },
  // ── Casos de la auditoría ──
  {
    id: "renewals",
    title: "Renewals Manager",
    sourceKind: "wwr",
    category: "remote-customer-support-jobs",
    career: null,
    text: "Renewals Manager at Empresa I, a SaaS company. Own the renewal cycle and churn. Protect the company's intellectual property and trademarks. We value our team identity.",
    named: ["churn_retention"],
  },
  {
    id: "nomina",
    title: "Payroll Specialist",
    sourceKind: "wwr",
    category: MF,
    career: "finanzas_contabilidad",
    text: "Empresa J hiring a Payroll Specialist. Payroll processing, nómina, benefits. We are focused on growth and make sure every run closes. Our vision is simple. Social security filings.",
    named: ["payroll"],
  },
  {
    id: "contable-ia",
    title: "Accounts Payable Analyst",
    sourceKind: "wwr",
    category: MF,
    career: "finanzas_contabilidad",
    text: "Empresa K: accounts payable, month-end close, QuickBooks. Marketing team and sales team send invoices. Identity of the company, growth, make it work, our vision for automation.",
    named: ["general_accounting", "erp_accounting"],
  },
  {
    id: "recruiter",
    title: "Technical Recruiter",
    sourceKind: "wwr",
    category: MF,
    career: null,
    text: "Empresa L seeks a Technical Recruiter. Talent sourcing, boolean search, behavioral interviews and applicant tracking system.",
    named: ["sourcing", "interviewing", "ats"],
  },
  {
    id: "loan-officer",
    title: "Mortgage Loan Officer",
    sourceKind: "wwr",
    category: MF,
    career: null,
    text: "Empresa M: originate mortgage loans, advise clients, close deals. Negotiation and cold outreach.",
    named: ["negotiation", "prospecting"],
  },
  {
    id: "consultor-ia",
    title: "AI Strategy Consultant",
    sourceKind: "wwr",
    category: MF,
    career: null,
    text: "Empresa N: advise clients on generative AI strategy; business strategy and business case. Our vision and company growth are clear.",
    named: ["business_strategy"],
  },
];

/** Cómo asignaba antes: categoría de la fuente más título, sin condicionar la categoría al título. */
function legacyHints(a: Aviso): RoleKey[] {
  const found = new Set<RoleKey>();
  const norm = a.category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  for (const r of SOURCE_CATEGORY_ROLES[a.sourceKind]?.[norm] ?? []) found.add(r);
  const padded = normalizeTitleText(a.title);
  for (const r of ROLE_KEYS) if (matchesRoleTitle(padded, r)) found.add(r);
  return ROLE_KEYS.filter((r) => found.has(r));
}

const hintsNow = (a: Aviso) =>
  inferRoleHints({
    sourceKind: a.sourceKind,
    title: a.title,
    categories: a.category ? [a.category] : [],
  });

const spurious = (slugs: string[], a: Aviso) => slugs.filter((s) => !a.named.includes(s));

describe("R11-9 · medición antes/después (avisos inventados)", () => {
  it("skills espurias por aviso: después ninguna en los casos de la auditoría", () => {
    const rows = AVISOS.map((a) => {
      const before = spurious(extractSkillsFromText(a.text, terms), a);
      const after = spurious(extractJdSkills(a.text, terms), a);
      return { aviso: a.id, antes: before.join(" ") || "-", despues: after.join(" ") || "-" };
    });
    console.table(rows);
    for (const a of AVISOS) {
      expect(spurious(extractJdSkills(a.text, terms), a), a.id).toEqual([]);
      // Lo que el texto nombra no se pierde
      for (const slug of a.named) {
        expect(extractJdSkills(a.text, terms), `${a.id} conserva ${slug}`).toContain(slug);
      }
    }
    const nBefore = AVISOS.reduce(
      (n, a) => n + spurious(extractSkillsFromText(a.text, terms), a).length,
      0,
    );
    expect(nBefore).toBeGreaterThan(0);
  });

  it("carrera: reclutador, oficial de crédito y consultor de IA no van a Contaduría", () => {
    const rows = AVISOS.map((a) => ({
      aviso: a.id,
      antes: legacyHints(a).join(" ") || "-",
      despues: hintsNow(a).join(" ") || "-",
    }));
    console.table(rows);
    for (const id of ["recruiter", "loan-officer", "consultor-ia", "renewals"]) {
      const a = AVISOS.find((x) => x.id === id)!;
      expect(hintsNow(a), id).not.toContain("finanzas_contabilidad");
    }
    // Antes sí caían ahí
    for (const id of ["recruiter", "loan-officer", "consultor-ia"]) {
      expect(legacyHints(AVISOS.find((x) => x.id === id)!), id).toContain("finanzas_contabilidad");
    }
  });

  it("las 8 carreras de la beta: el aviso propio sigue con su carrera", () => {
    const own = AVISOS.filter((a) => a.career !== null && AVISOS.indexOf(a) < 8);
    const rows = own.map((a) => ({
      carrera: a.career,
      antes: legacyHints(a).includes(a.career!) ? "sí" : "no",
      despues: hintsNow(a).includes(a.career!) ? "sí" : "no",
      "espurias antes": spurious(extractSkillsFromText(a.text, terms), a).length,
      "espurias después": spurious(extractJdSkills(a.text, terms), a).length,
    }));
    console.table(rows);
    for (const a of own) expect(hintsNow(a), a.id).toContain(a.career);
  });
});
