import { describe, expect, it } from "vitest";
import criteria from "../../db/seeds/criteria.example.json";
import abogacia from "../test/fixtures/carreras/abogacia.json";
import administracion from "../test/fixtures/carreras/administracion_empresas.json";
import comunicacion from "../test/fixtures/carreras/comunicacion.json";
import contaduria from "../test/fixtures/carreras/finanzas_contabilidad.json";
import marketing from "../test/fixtures/carreras/marketing_digital.json";
import rrii from "../test/fixtures/carreras/relaciones_internacionales.json";
import type { CriteriaRules } from "./criteria";
import { assessPoolTitle } from "./pool/title-fit";
import { prefilter, type PrefilterModality } from "./prefilter/prefilter";
import { inferRoleHints } from "./skills/role-hints";
import type { RoleKey } from "./skills/self-assessment";

/**
 * C8-9 · El prefiltro y el encaje por título frente al golden sintético de carreras (C8-8). Determinista,
 * sin LLM: para la persona de referencia (Salta, 2 años, acepta las tres modalidades), un aviso «llega»
 * si su título suma la carrera en los hints, el título no la veta, no es un cargo inalcanzable
 * (`isTooSenior`) y pasa el prefiltro. Falla si un `must_pass` no llega o un `must_discard` llega.
 */
type Caso = {
  id: string;
  categoria: string;
  titulo: string;
  ubicacion_raw: string;
  modalidad: string;
  jd_text: string;
  etiquetas: { prefiltro: string; flags_esperados: string[] };
};
type Doc = {
  meta: {
    carrera: string;
    persona: { ciudad: string; pais: string; anos_experiencia: number; modalidades: string[] };
  };
  casos: Caso[];
};

const DOCS = [abogacia, administracion, comunicacion, contaduria, marketing, rrii] as Doc[];
const rules = criteria as CriteriaRules;

export function reachesPerson(doc: Doc, c: Caso) {
  const role = doc.meta.carrera as RoleKey;
  const p = doc.meta.persona;
  const hints = inferRoleHints({ sourceKind: "other", title: c.titulo });
  const title = assessPoolTitle({
    title: c.titulo,
    roleHints: hints,
    roles: [role],
    yearsTotal: p.anos_experiencia,
  });
  const pf = prefilter(
    {
      title: c.titulo,
      modality: c.modalidad as PrefilterModality,
      locationRaw: c.ubicacion_raw,
      jdText: c.jd_text,
    },
    rules,
    {
      targetRoles: [role],
      acceptedModalities: p.modalidades as PrefilterModality[],
      userCity: p.ciudad,
      userCountry: p.pais,
    },
  );
  const reaches = hints.includes(role) && title.titleFit > 0 && !title.tooSenior && pf.pass;
  return { reaches, hints, title, pf };
}

describe("golden de carreras: prefiltro y encaje por título (C8-9)", () => {
  for (const doc of DOCS) {
    describe(doc.meta.carrera, () => {
      it.each(doc.casos.map((c) => [c.id, c.categoria, c] as const))("%s (%s)", (_id, _cat, c) => {
        const r = reachesPerson(doc, c);
        const why = r.pf.pass
          ? `hints=${JSON.stringify(r.hints)} titleFit=${r.title.titleFit} tooSenior=${r.title.tooSenior}`
          : `prefiltro: ${r.pf.reason} (${r.pf.detail})`;
        expect(r.reaches, `«${c.titulo}» → ${why}`).toBe(c.etiquetas.prefiltro === "must_pass");
      });
    });
  }

  it("lo que llega lleva las marcas esperadas (ubicación, modalidad, residencia)", () => {
    for (const doc of DOCS) {
      for (const c of doc.casos.filter((x) => x.etiquetas.prefiltro === "must_pass")) {
        const { pf } = reachesPerson(doc, c);
        if (!pf.pass) continue;
        const flags = pf.flags.map((f) => f.split(":")[0]);
        for (const expected of c.etiquetas.flags_esperados) {
          expect(flags, `${c.id}: falta la marca ${expected}`).toContain(expected);
        }
      }
    }
  });
});
