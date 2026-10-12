import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import criteria from "../../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "../criteria";
import type { RoleKey } from "../skills/self-assessment";
import {
  prefilter,
  ROLE_DOMAIN_KEYWORDS,
  skillsMatchRatioFromBadges,
  type PrefilterInput,
} from "./prefilter";

const rules = criteria as CriteriaRules;

type GoldenJob = {
  id: number;
  empresa: string;
  titulo: string;
  modalidad: string;
  ubicacion_raw: string;
  badges: string[];
  candidatos: number | null;
};
const jobs = golden.jobs as GoldenJob[];
const expectations = golden.prefilter_expectations;

/** Solo lo que trae un email de alerta: título, empresa, ubicación, modalidad, badges, candidatos. */
function fromEmail(j: GoldenJob): PrefilterInput {
  return {
    title: j.titulo,
    companyRaw: j.empresa,
    locationRaw: j.ubicacion_raw,
    modality: j.modalidad as PrefilterInput["modality"],
    badges: j.badges,
    candidatesCount: j.candidatos,
  };
}
const byId = (id: number) => fromEmail(jobs.find((j) => j.id === id)!);
// prettier-ignore
const PASS_BEFORE: boolean[] = [
  true, false, false, true, false, true, true, false, true, true, false, true, true, false,
  true, true, false, false, true, true, false, false, false, true, true, false, false, true,
  true, true, false, true, true, true, true, true,
];

describe("prefilter: expectativas del golden (sin LLM)", () => {
  it.each(expectations.must_discard)("descarta id %i sin LLM", (id) => {
    const r = prefilter(byId(id), rules);
    expect(r.pass, JSON.stringify(r)).toBe(false);
  });

  it.each(expectations.must_pass)("deja pasar id %i", (id) => {
    const r = prefilter(byId(id), rules);
    expect(r.pass, JSON.stringify(r)).toBe(true);
  });

  it("aplica cap 5 a Empresa L Lead (id 13) por ≤5 candidatos y ai_engineer, sin descartar", () => {
    const r = prefilter(byId(13), rules);
    expect(r).toMatchObject({ pass: true, cap: 5 });
    if (r.pass) expect(r.flags).toContain("title_cap");
  });

  it.each(expectations.discard_by_badge)("descarta id %i por badge de aptitudes < 40%", (id) => {
    const r = prefilter(byId(id), rules);
    expect(r).toMatchObject({ pass: false, reason: "badge_aptitudes" });
  });

  it("los riesgos no descartan: país no listado (32), LATAM sin países (34), muchos candidatos (6)", () => {
    for (const id of [32, 34, 6]) expect(prefilter(byId(id), rules).pass).toBe(true);
    const latam = prefilter(byId(34), rules);
    if (latam.pass) expect(latam.flags).toContain("location_risk");
    const crowded = prefilter(byId(6), rules);
    if (crowded.pass) expect(crowded.flags).toContain("many_candidates");
  });
});

describe("prefilter: targetRole (ronda 40)", () => {
  const run = (title: string, targetRole?: RoleKey | null) =>
    prefilter({ title, modality: "remoto" }, rules, targetRole === undefined ? {} : { targetRole });

  it("SEO Specialist descarta sin puesto y pasa con marketing_digital", () => {
    expect(run("SEO Specialist")).toMatchObject({ pass: false, reason: "disciplina_distinta" });
    expect(run("SEO Specialist", null)).toMatchObject({ pass: false });
    const r = run("SEO Specialist", "marketing_digital");
    expect(r.pass).toBe(true);
    if (r.pass) expect(r.flags.some((f) => f.startsWith("domain_keyword"))).toBe(false);
  });

  it("Project Manager pasa con producto_proyectos y descarta con frontend", () => {
    expect(run("Project Manager", "producto_proyectos").pass).toBe(true);
    expect(run("Project Manager", "frontend")).toMatchObject({ pass: false });
    expect(run("Project Manager")).toMatchObject({ pass: false });
  });

  it("Cybersecurity Analyst pasa con ciberseguridad", () => {
    expect(run("Cybersecurity Analyst")).toMatchObject({ pass: false });
    expect(run("Cybersecurity Analyst", "ciberseguridad").pass).toBe(true);
  });

  it("la excepción es solo del oficio propio de cada puesto", () => {
    expect(run("SEO Specialist", "producto_proyectos")).toMatchObject({ pass: false });
    expect(run("Project Manager", "marketing_digital")).toMatchObject({ pass: false });
    // una palabra de otro oficio en el mismo título sigue descartando
    expect(run("SEO y Medios de Pago", "marketing_digital")).toMatchObject({ pass: false });
  });

  it("atención al cliente y call center siguen descartando", () => {
    expect(run("Atención al cliente", "customer_success")).toMatchObject({ pass: false });
    expect(run("Call Center", "customer_success")).toMatchObject({ pass: false });
  });

  it("de la blocklist solo se libera la palabra que es parte del oficio propio", () => {
    expect(run("Project Manager", "producto_proyectos").pass).toBe(true);
    expect(run("Lead Project Manager", "producto_proyectos")).toMatchObject({
      pass: false,
      reason: "titulo_blocklist",
    });
    expect(run("Engineering Manager", "producto_proyectos")).toMatchObject({ pass: false });
  });

  it("la blocklist solo libera el cargo propio del puesto", () => {
    const withLists = rules.title_blocklist;
    expect(withLists).toContain("manager");
    expect(withLists).toContain("lead");
    expect(run("Product Manager", "producto_proyectos").pass).toBe(true);
    expect(run("Customer Success Manager", "customer_success").pass).toBe(true);
    expect(run("Product Manager", "frontend")).toMatchObject({ pass: false });
    expect(run("Customer Success Manager", "frontend")).toMatchObject({ pass: false });
    expect(run("Customer Success Manager")).toMatchObject({ pass: false });
    expect(run("Engineering Manager — Project Manager", "producto_proyectos")).toMatchObject({
      pass: false,
      reason: "titulo_blocklist",
    });
    expect(run("Lead Product Manager", "producto_proyectos")).toMatchObject({ pass: false });
  });

  it("límite de palabra: Williams, Diamond y Seoul no activan la excepción", () => {
    expect(run("Williams Engineer", "ciberseguridad").pass).toBe(true);
    expect(run("Diamond Backend Developer", "ciberseguridad").pass).toBe(true);
    expect(run("Seoul Specialist", "marketing_digital").pass).toBe(true);
    // la palabra pegada a otra no se libera ni se borra del título: la blocklist sigue viendo "manager"
    expect(run("Seoul Manager", "marketing_digital")).toMatchObject({ pass: false });
    expect(run("Pmpx Manager", "producto_proyectos")).toMatchObject({ pass: false });
    expect(run("Diamond Sailpoint Williams", "marketing_digital")).toMatchObject({ pass: false });
    // lo que sí es la palabra, con puesto, pasa
    expect(run("IAM Engineer", "ciberseguridad").pass).toBe(true);
    expect(run("PMP Project Manager", "producto_proyectos").pass).toBe(true);
  });

  it("puestos sin entradas no cambian nada y todas las palabras existen en las reglas", () => {
    expect(run("SEO Specialist", "rrhh_it")).toMatchObject({ pass: false });
    expect(run("Backend Developer", "backend").pass).toBe(true);
    for (const words of Object.values(ROLE_DOMAIN_KEYWORDS)) {
      for (const w of words ?? []) expect(rules.other_discipline_keywords).toContain(w);
    }
  });
});

describe("prefilter: reglas una por una", () => {
  const base: PrefilterInput = { title: "AI Engineer", modality: "remoto" };

  it("modalidad presencial o híbrida → descarte (bloqueador duro)", () => {
    expect(prefilter({ ...base, modality: "presencial" }, rules)).toMatchObject({
      pass: false,
      reason: "modalidad_no_remota",
    });
    expect(prefilter({ ...base, modality: "hibrido" }, rules).pass).toBe(false);
  });

  it("modalidad desconocida pero la ubicación dice híbrido/presencial/on-site → descarte", () => {
    for (const loc of [
      "Buenos Aires (híbrido)",
      "CABA presencial",
      "Hybrid - Madrid",
      "On-site NYC",
    ]) {
      expect(prefilter({ ...base, modality: "desconocida", locationRaw: loc }, rules).pass).toBe(
        false,
      );
    }
    expect(
      prefilter({ ...base, modality: "desconocida", locationRaw: "Argentina (remoto)" }, rules)
        .pass,
    ).toBe(true);
  });

  describe("remoteOnly: false (la persona acepta híbrido y presencial)", () => {
    const open = { remoteOnly: false };
    const flagOnce = (r: ReturnType<typeof prefilter>) =>
      r.pass && r.flags.filter((f) => f === "modalidad_no_remota").length === 1;

    it("híbrida y presencial pasan con el flag", () => {
      for (const modality of ["hibrido", "presencial"] as const) {
        const r = prefilter({ ...base, modality }, rules, open);
        expect(r.pass).toBe(true);
        expect(flagOnce(r)).toBe(true);
      }
    });
    it("título '(Híbrido)' pasa con el flag, una sola vez aunque coincidan varias señales", () => {
      const r = prefilter(
        { title: "AI Engineer (Híbrido)", modality: "hibrido", locationRaw: "CABA presencial" },
        rules,
        open,
      );
      expect(flagOnce(r)).toBe(true);
    });
    it("ubicación con híbrido y modalidad desconocida pasa con el flag", () => {
      const r = prefilter(
        { ...base, modality: "desconocida", locationRaw: "Buenos Aires (híbrido)" },
        rules,
        open,
      );
      expect(flagOnce(r)).toBe(true);
    });
    it("un aviso remoto no recibe el flag", () => {
      const r = prefilter(base, rules, open);
      expect(r).toMatchObject({ pass: true });
      expect(r.pass && r.flags).not.toContain("modalidad_no_remota");
    });
    it("las demás reglas siguen descartando", () => {
      expect(
        prefilter({ title: "Project Manager", modality: "hibrido" }, rules, open),
      ).toMatchObject({ pass: false, reason: "disciplina_distinta" });
    });
    it("con remoteOnly true o sin la opción se descarta como siempre", () => {
      const hybrid = { title: "AI Engineer (Híbrido)", modality: "hibrido" } as const;
      expect(prefilter(hybrid, rules)).toMatchObject({
        pass: false,
        reason: "modalidad_no_remota",
      });
      expect(prefilter(hybrid, rules, { remoteOnly: true })).toMatchObject({
        pass: false,
        reason: "modalidad_no_remota",
      });
    });
  });

  it("keywords de otra disciplina en el título → descarte (ML engineer, AI eval, IAM, PM...)", () => {
    for (const title of [
      "IAM Engineer SailPoint",
      "Project Manager",
      "Scrum Master",
      "ML Engineer (PyTorch, fine-tuning)",
      "LLM Red-Teaming Specialist",
    ]) {
      expect(prefilter({ ...base, title }, rules)).toMatchObject({
        pass: false,
        reason: "disciplina_distinta",
      });
    }
  });

  it("keyword de dominio con señal de IA en el título → pasa con flag (Empresa X: Senior AI Engineer — Growth)", () => {
    const r = prefilter({ ...base, title: "Senior AI Engineer — Growth" }, rules);
    expect(r.pass && r.flags).toContain("domain_keyword:growth");
    expect(prefilter({ ...base, title: "Growth Marketing Manager" }, rules).pass).toBe(false);
    // ML engineer y AI eval descartan aunque el título diga AI
    expect(
      prefilter({ ...base, title: "AI Engineer (fine-tuning, PyTorch)" }, rules),
    ).toMatchObject({
      pass: false,
      reason: "disciplina_distinta",
    });
  });

  it("título en blocklist → descarte; allowlist lo exime; excepción cap 5 con ≤5 candidatos y ai_engineer", () => {
    expect(prefilter({ ...base, title: "Engineering Manager" }, rules)).toMatchObject({
      pass: false,
      reason: "titulo_blocklist",
    });
    expect(prefilter({ ...base, title: "Head of AI" }, rules).pass).toBe(false);
    expect(prefilter({ ...base, title: "VP Engineering" }, rules).pass).toBe(false);
    expect(prefilter({ ...base, title: "Agent Architect" }, rules).pass).toBe(true);
    expect(
      prefilter({ ...base, title: "Lead AI Engineer", candidatesCount: 5 }, rules),
    ).toMatchObject({
      pass: true,
      cap: 5,
    });
    // Lead con pocos candidatos pero sin señal de IA en el título → no aplica la excepción
    expect(prefilter({ ...base, title: "Tech Lead .NET", candidatesCount: 2 }, rules).pass).toBe(
      false,
    );
    // Lead de IA con muchos candidatos → descarte
    expect(prefilter({ ...base, title: "Lead AI Engineer", candidatesCount: 40 }, rules).pass).toBe(
      false,
    );
  });

  it("badge de aptitudes: < 40% descarta, ≥ 60% marca skills_match_high, entre medio pasa sin flag", () => {
    expect(skillsMatchRatioFromBadges(["3 de 4 aptitudes coinciden"])).toBeCloseTo(0.75);
    expect(skillsMatchRatioFromBadges(["En busca de personal"])).toBeNull();
    expect(prefilter({ ...base, badges: ["1 de 5 aptitudes coinciden"] }, rules).pass).toBe(false);
    const high = prefilter({ ...base, badges: ["3 de 4 aptitudes coinciden"] }, rules);
    expect(high.pass && high.flags).toContain("skills_match_high");
    const mid = prefilter({ ...base, badges: ["1 de 2 aptitudes coinciden"] }, rules);
    expect(mid.pass && mid.flags).not.toContain("skills_match_high");
    expect(prefilter({ ...base, skillsMatchRatio: 0.2 }, rules).pass).toBe(false);
  });

  it("ubicación: nunca descarta; marca location_risk con LATAM/remote sin países o AR fuera de la lista", () => {
    const latam = prefilter({ ...base, locationRaw: "LATAM (100% remote)" }, rules);
    expect(latam.pass && latam.flags).toContain("location_risk");
    const listed = prefilter({ ...base, countriesAllowed: ["US", "BR", "CA"] }, rules);
    expect(listed.pass && listed.flags).toContain("location_risk");
    const ok = prefilter(
      { ...base, locationRaw: "Argentina (remoto)", countriesAllowed: ["AR", "CL"] },
      rules,
    );
    expect(ok.pass && ok.flags).not.toContain("location_risk");
    const anywhere = prefilter({ ...base, locationRaw: "Work from Anywhere" }, rules);
    expect(anywhere.pass && anywhere.flags).not.toContain("location_risk");
  });

  describe("ubicación: reglas de riesgo del aviso (JS-055), solo agregan el flag", () => {
    const flagsFor = (locationRaw: string) => {
      const r = prefilter({ ...base, locationRaw }, rules);
      expect(r.pass, locationRaw).toBe(true);
      return r.pass ? r.flags : [];
    };

    it.each([
      "US-based",
      "Remoto (EE.UU.)",
      "United States",
      "Remote, USA only",
      "Norteamérica (remoto)",
      "Americas",
      "Europe (remote)",
      "EMEA",
      "Canada",
    ])("región o país extranjero sin Argentina → location_risk: %s", (loc) => {
      expect(flagsFor(loc)).toContain("location_risk");
    });

    it("región ajena que menciona Argentina no marca", () => {
      expect(flagsFor("Argentina o US (remoto)")).not.toContain("location_risk");
      expect(flagsFor("Americas, incluida Argentina")).not.toContain("location_risk");
    });

    it("el huso horario de EE.UU. es riesgo de horario, no de ubicación: no marca", () => {
      expect(flagsFor("Argentina (remoto), overlap con US Eastern time")).not.toContain(
        "location_risk",
      );
      expect(flagsFor("Argentina (remoto), horario EST")).not.toContain("location_risk");
    });

    it("'aviso:' no es un formato de las fuentes: no marca", () => {
      expect(flagsFor("Argentina (remoto); aviso: Canada; US; LATAM")).not.toContain(
        "location_risk",
      );
    });

    it.each([
      "Remoto (Argentina)",
      "Work from anywhere",
      "Argentina (remoto)",
      "Argentina (remoto) — trabajo desde tu propio país",
      "Remoto (Chile, Argentina, Perú, Colombia, México)",
      "Buenos Aires, Argentina (remoto, husos horarios de Latinoamérica)",
      "Remoto, con un cliente de ejemplo en Argentina",
    ])("lo que hoy no marca sigue sin marcarse: %s", (loc) => {
      expect(flagsFor(loc)).not.toContain("location_risk");
    });

    it("nunca descarta ni cambia el cap: solo suma el flag", () => {
      const sin = prefilter({ ...base, locationRaw: "Argentina (remoto)" }, rules);
      const con = prefilter({ ...base, locationRaw: "US-based" }, rules);
      expect(sin.pass && con.pass).toBe(true);
      if (sin.pass && con.pass) {
        expect(con.cap).toBe(sin.cap);
        expect(con.flags.filter((f) => f !== "location_risk")).toEqual(sin.flags);
      }
    });

    it("golden público: ninguna referencia 'ok' queda marcada por la regla nueva", () => {
      const flagged = (id: number) => {
        const r = prefilter(byId(id), rules);
        return r.pass && r.flags.includes("location_risk");
      };
      // 3, 17 y 31 los descarta el prefiltro por otra regla (disciplina, título, badge) antes de
      // llegar a la ubicación: el descarte no lleva flags
      expect(prefilter(byId(3), rules)).toMatchObject({
        pass: false,
        reason: "disciplina_distinta",
      });
      expect(prefilter(byId(17), rules)).toMatchObject({ pass: false, reason: "titulo_blocklist" });
      expect(prefilter(byId(31), rules)).toMatchObject({ pass: false, reason: "badge_aptitudes" });
      const okIds = (golden.jobs as (GoldenJob & { human_location_ok: string })[])
        .filter((j) => j.human_location_ok === "ok")
        .map((j) => j.id);
      // El 4 ("Ciudad (remoto)" sin país) ya lo marcaba la regla de remoto sin país, no las nuevas
      expect(okIds.filter(flagged)).toEqual([4]);
    });

    it("no regresión: ninguna oferta del golden público cambia de pass", () => {
      // Vector de pass registrado antes de las reglas nuevas (ids en orden).
      const expected = PASS_BEFORE;
      const actual = jobs.map((j) => prefilter(byId(j.id), rules).pass);
      expect(actual).toEqual(expected);
    });
  });

  describe("país del perfil (JS-104)", () => {
    const risk = (
      locationRaw: string,
      userCountry?: string | null,
      countriesAllowed?: string[],
    ) => {
      const r = prefilter(
        { ...base, locationRaw, countriesAllowed },
        rules,
        userCountry === undefined ? {} : { userCountry },
      );
      expect(r.pass, locationRaw).toBe(true);
      return r.pass && r.flags.includes("location_risk");
    };

    it("perfil MX con oferta 'Mexico only' pasa sin riesgo", () => {
      expect(risk("Mexico only", "MX")).toBe(false);
      expect(risk("Remoto (México)", "mx")).toBe(false);
      expect(risk("Remote", "MX", ["MX", "CO"])).toBe(false);
    });

    it("perfil MX con 'Argentina only' queda con riesgo", () => {
      expect(risk("Argentina only", "MX")).toBe(true);
      expect(risk("Remote", "MX", ["AR", "CL"])).toBe(true);
      expect(risk("Remoto (Chile, Argentina, Perú)", "MX")).toBe(true);
    });

    it("perfil AR explícito marca un país vecino sin Argentina, y no si la nombra", () => {
      expect(risk("Brasil (remoto)", "AR")).toBe(true);
      expect(risk("Brasil o Argentina", "AR")).toBe(false);
    });

    it("país desconocido (null): toda restricción de ubicación queda con riesgo", () => {
      expect(risk("Argentina only", null)).toBe(true);
      expect(risk("Mexico only", null)).toBe(true);
      expect(risk("LATAM (remote)", null)).toBe(true);
      expect(risk("US-based", null)).toBe(true);
      expect(risk("Remote", null, ["MX"])).toBe(true);
    });

    it("país desconocido: sin restricción (anywhere, '*', sin ubicación) no marca", () => {
      expect(risk("Work from anywhere", null)).toBe(false);
      expect(risk("Remote", null, ["*"])).toBe(false);
      expect(risk("", null)).toBe(false);
    });

    it("sin el parámetro el comportamiento es el de hoy (AR)", () => {
      expect(risk("Argentina (remoto)")).toBe(false);
      expect(risk("LATAM (remote)")).toBe(true);
      expect(risk("Mexico only")).toBe(false);
      expect(risk("Remote", undefined, ["AR"])).toBe(false);
    });
  });

  it("candidatos ≥ 100 → flag many_candidates, no descarta", () => {
    const r = prefilter({ ...base, candidatesCount: 264 }, rules);
    expect(r.pass && r.flags).toContain("many_candidates");
  });

  describe("modalidad no remota en el título", () => {
    const run = (title: string, modality: PrefilterInput["modality"] = null) =>
      prefilter({ title, locationRaw: "Argentina", modality }, rules);

    it.each([
      ["Desarrollador Backend - Hibrido, CABA", null],
      ["Frontend Engineer (Hybrid, Ciudad X)", "remoto"],
      ["Presencial - Analista de Datos - Empresa A", null],
      ["Backend Engineer (Presencial)", "remoto"],
      ["Backend Engineer - On-site", null],
      ["Backend Engineer, onsite", null],
      ["Backend Engineer | In-office", null],
      ["Backend Engineer - Hybrid -", null],
      ["Backend Engineer / Híbrido", null],
      ["Remote / Hybrid", null],
      ["Desarrollador Python - En oficina", null],
      ["Backend Engineer (Hibrida)", "remoto"],
      ["Backend Engineer - Hybrid, flexible hours", null],
      ["Desarrollador (Híbrido CABA)", null],
      ["Backend (Presencial en Madrid)", "remoto"],
      ["Backend Engineer - On-site Madrid", null],
    ] as const)("%s (fuente: %s) → modalidad_no_remota", (title, modality) => {
      const r = run(title, modality);
      expect(r).toMatchObject({ pass: false, reason: "modalidad_no_remota" });
      expect(!r.pass && r.detail).toBe(`título: ${title}`);
    });

    it.each([
      "Senior Engineer, remote-first, hybrid optional",
      "Senior Engineer (Hybrid optional)",
      "Senior Engineer - Hybrid (optional)",
      "Ingeniero Backend - híbrido opcional",
      "Ingeniero Backend - Híbrido flexible",
      "Ingeniero de Sistemas Hibridos de IA",
      "Hybrid Cloud Engineer",
      "Hybrid-Cloud Architect",
      "Non-onsite Backend Engineer",
      "Non-hybrid Platform Engineer",
      "Backend Engineer - Onsite interviews",
      "Senior Hybrid Cloud Engineer",
      "Hybrid apps Developer",
      "Desarrollador Fullstack (Remoto)",
    ])("%s → no descarta por modalidad", (title) => {
      const r = run(title, "remoto");
      expect(r.pass || r.reason !== "modalidad_no_remota").toBe(true);
    });
  });

  describe("avisos que no son IT (títulos de otros oficios, bases de RR. HH.)", () => {
    const run = (title: string) =>
      prefilter({ title, companyRaw: "Empresa Demo SA", modality: "remoto" }, rules);

    it.each([
      ["Administrativo/a", "administrativ"],
      ["Asistente Administrativa", "administrativ"],
      ["ADMINISTRATIVO(A) contable", "administrativ"],
      ["Administrativ@ de compras", "administrativ"],
      ["Auxiliar Contable", "auxiliar contable"],
      ["Recepcionista", "recepcionista"],
      ["Cajero/a", "cajer"],
      ["Vendedor(a) de mostrador", "vendedor"],
      ["Vendedora", "vendedor"],
      ["Atención al Cliente", "atencion al cliente"],
      ["Operador de Call Center", "call center"],
      ["Operario de planta", "operari"],
      ["Repositor/a", "repositor"],
      ["Chofer de reparto", "chofer"],
      ["Mozo / Moza", "moz"],
      ["Abogado/a laboralista", "abogad"],
    ])("otro oficio: %s → disciplina_distinta", (title, stem) => {
      const r = run(title);
      expect(r).toMatchObject({ pass: false, reason: "disciplina_distinta" });
      expect(!r.pass && r.detail).toBe(`título fuera de IT: '${stem}'`);
    });

    it.each([
      "Cargá tu CV",
      "Dejanos tu CV",
      "Envianos tu CV - Empresa Demo SA",
      "Base de talentos",
      "Búsquedas generales",
      "Postulación espontánea",
      "Talent Pool",
    ])("base genérica de RR. HH.: %s → disciplina_distinta", (title) => {
      const r = run(title);
      expect(r).toMatchObject({ pass: false, reason: "disciplina_distinta" });
      expect(!r.pass && r.detail).toMatch(/^título fuera de IT: /);
    });

    it.each([
      ["Ingresá tu CV - Base general", "base de CV"],
      ["Registrá tu CV", "base de CV"],
      ["Registrate tu CV en Empresa Demo SA", "base de CV"],
      ["Sumate tu CV", "base de CV"],
      ["Sumate a nuestra base general", "base general"],
      ["Base general de postulantes", "base general"],
      ["Base General de CV - Empresa Demo SA", "base general"],
    ])("base genérica de RR. HH.: %s → '%s'", (title, label) => {
      const r = run(title);
      expect(r).toMatchObject({ pass: false, reason: "disciplina_distinta" });
      expect(!r.pass && r.detail).toBe(`título fuera de IT: '${label}'`);
    });

    it("la base de RR. HH. descarta siempre, aunque mencione IT", () => {
      expect(run("Cargá tu CV — perfiles IT")).toMatchObject({ pass: false });
      expect(run("Talent Pool Developer")).toMatchObject({ pass: false });
      expect(run("Base de talentos de AI Engineers")).toMatchObject({ pass: false });
    });

    it.each([
      "Vendedor de insumos informáticos",
      "Abogado/a en derecho informático",
      "Administrativo para empresa de servicios informáticos",
      "Vendedora de equipos de informática",
    ])("'informático' no es señal IT por sí sola: %s", (title) => {
      expect(run(title)).toMatchObject({ pass: false, reason: "disciplina_distinta" });
    });

    it.each([
      "Analista informático",
      "Técnico informático",
      "Desarrollador/a Full Stack para área administrativa",
      "Ingeniero/a de Software — Sistemas de ventas",
      "AI Engineer — Customer Support",
      "Data Analyst — Contabilidad",
      "Diseñador/a gráfico con IA generativa",
      "Editor/a de video con IA",
      "Vendedor/a de soluciones de IA",
      "DevOps para sistema de recepcionistas",
      "Data Analyst — Recepción de pedidos con recepcionista",
      "Backend Developer — Call Center",
      "Soporte técnico / Atención al cliente",
      "Help Desk – atención al cliente",
      "Administrativo/a de sistemas",
      "Soporte IT — Operario de planta",
    ])("no descarta con señal IT o de IA: %s", (title) => {
      expect(run(title)).toMatchObject({ pass: true });
    });

    it("acentos y mayúsculas no importan", () => {
      expect(run("RECEPCIONISTA")).toMatchObject({ pass: false });
      expect(run("Atencion al cliente")).toMatchObject({ pass: false });
    });

    it("no matchea dentro de otra palabra", () => {
      expect(run("Mozilla Add-ons Reviewer").pass).toBe(true);
      expect(run("Administrative Assistant AI").pass).toBe(true);
    });
  });

  it("el orden de las razones es determinista: modalidad antes que título", () => {
    const r = prefilter({ ...base, title: "Engineering Manager", modality: "presencial" }, rules);
    expect(r).toMatchObject({ pass: false, reason: "modalidad_no_remota" });
  });
});
