import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import criteria from "../../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "../criteria";
import { prefilter, skillsMatchRatioFromBadges, type PrefilterInput } from "./prefilter";

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

  it("candidatos ≥ 100 → flag many_candidates, no descarta", () => {
    const r = prefilter({ ...base, candidatesCount: 264 }, rules);
    expect(r.pass && r.flags).toContain("many_candidates");
  });

  it("el orden de las razones es determinista: modalidad antes que título", () => {
    const r = prefilter({ ...base, title: "Engineering Manager", modality: "presencial" }, rules);
    expect(r).toMatchObject({ pass: false, reason: "modalidad_no_remota" });
  });
});
