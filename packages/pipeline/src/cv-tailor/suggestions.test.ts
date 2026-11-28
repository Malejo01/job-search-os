import { describe, expect, it } from "vitest";
import { buildCvDocument, type CvSourceData } from "../cv-out/model";
import type { CvTailorOutput } from "./schemas";
import { buildTailorSuggestions, composeTailorProposal } from "./suggestions";
import { verifyCvTailor } from "./verify";

// CV inventado: ningún dato real.
const data: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  city: "Ciudad A",
  country: "País A",
  links: {},
  headline: "Analista de datos",
  summary: null,
  skills: [
    { name: "SQL", category: "Datos" },
    { name: "Excel", category: "Datos" },
    { name: "Python", category: "Datos" },
  ],
  languages: [],
  achievements: [],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2021-03",
      endMonth: null,
      bullets: [
        "Armé reportes semanales de ventas en Excel",
        "Coordiné pedidos de datos con 4 áreas",
        "Automaticé la carga de datos con SQL",
      ],
    },
    {
      kind: "trabajo",
      organization: "Empresa B",
      title: "Asistente",
      startMonth: "2019-01",
      endMonth: "2021-02",
      bullets: ["Organicé la agenda de la gerencia", "Atendí consultas de clientes"],
    },
  ],
};
const doc = buildCvDocument(data, { lang: "es", includeEmail: true });

const proposal: CvTailorOutput = {
  entries: [
    {
      ref: "experience-0",
      bullets: [
        "Automaticé la carga de datos con SQL",
        "Armé reportes semanales de ventas en Excel",
      ],
    },
    {
      ref: "experience-1",
      bullets: ["Atendí consultas de clientes", "Organicé la agenda de la gerencia"],
    },
  ],
  skills: ["SQL", "Python", "Excel"],
  changes: [{ what: "Puse SQL primero", why: "El aviso pide SQL" }],
};

describe("buildTailorSuggestions", () => {
  it("arma una sugerencia por entrada que cambia y una para el orden de skills", () => {
    const v = verifyCvTailor(doc, proposal);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const s = buildTailorSuggestions(doc, v.value.document);
    expect(s.map((x) => x.id)).toEqual(["experience-0", "experience-1", "skills"]);
    expect(s[0]?.before).toContain("Coordiné pedidos de datos con 4 áreas");
    expect(s[0]?.after).not.toContain("Coordiné pedidos de datos con 4 áreas");
    expect(s[0]?.editable).toBe(true);
    expect(s[2]?.editable).toBe(false);
  });

  it("no ofrece lo que no cambió", () => {
    const same = verifyCvTailor(doc, { entries: [], skills: [], changes: [] });
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(buildTailorSuggestions(doc, same.value.document)).toEqual([]);
  });
});

describe("composeTailorProposal", () => {
  it("acepta, descarta y edita de a una; lo descartado deja la entrada como estaba", () => {
    const out = composeTailorProposal(proposal, [
      { id: "experience-0", action: "accept" },
      { id: "experience-1", action: "discard" },
      { id: "skills", action: "discard" },
    ]);
    expect(out.entries.map((e) => e.ref)).toEqual(["experience-0"]);
    expect(out.skills).toEqual([]);
    const v = verifyCvTailor(doc, out);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const b1 = v.value.document.sections.find((s) => s.id === "experience")!.blocks[1]!;
    expect(b1.bullets).toEqual([
      "Organicé la agenda de la gerencia",
      "Atendí consultas de clientes",
    ]);
  });

  it("una edición reemplaza las viñetas de esa entrada", () => {
    const out = composeTailorProposal(proposal, [
      { id: "experience-0", action: "edit", bullets: ["Automaticé la carga de datos con SQL"] },
    ]);
    expect(out.entries).toEqual([
      { ref: "experience-0", bullets: ["Automaticé la carga de datos con SQL"] },
    ]);
  });

  it("una edición que suma algo no declarado la rechaza el verificador (el CV no inventa)", () => {
    const out = composeTailorProposal(proposal, [
      { id: "experience-0", action: "edit", bullets: ["Lideré un equipo de 12 personas"] },
    ]);
    const v = verifyCvTailor(doc, out);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.ref).toBe("experience-0");
  });

  it("lo que no tiene decisión no entra (nada se aplica solo) y se ignoran ids desconocidos", () => {
    const out = composeTailorProposal(proposal, [{ id: "otra-cosa", action: "accept" }]);
    expect(out).toEqual({ entries: [], skills: [], changes: [] });
  });

  it("los cambios explicados solo viajan si algo se aceptó", () => {
    const acc = composeTailorProposal(proposal, [{ id: "skills", action: "accept" }]);
    expect(acc.changes).toEqual(proposal.changes);
    expect(acc.skills).toEqual(proposal.skills);
  });
});
