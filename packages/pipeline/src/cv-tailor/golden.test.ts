import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCvDocument, type CvSourceData } from "../cv-out/model";
import {
  checkCvTailorCase,
  CV_TAILOR_GOLDEN_SIZE,
  parseCvTailorGolden,
  summarizeCvTailorChecks,
} from "./golden";
import { verifyCvTailor } from "./verify";

const data: CvSourceData = {
  displayName: "Persona Ficticia",
  skills: [
    { name: "Excel", category: "Datos" },
    { name: "SQL", category: "Datos" },
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
      bullets: ["Armé reportes en Excel", "Automaticé la carga con SQL"],
    },
  ],
};
const doc = buildCvDocument(data, { lang: "es" });
const verified = (entries: { ref: string; bullets: string[] }[], skills: string[] = []) => {
  const r = verifyCvTailor(doc, { entries, skills, changes: [] });
  if (!r.ok) throw new Error("no pasa");
  return r.value.document;
};

describe("checkCvTailorCase", () => {
  const expected = {
    forbidden: ["Docker"],
    firstBullet: { ref: "experience-0", contains: "SQL" },
    firstSkills: ["SQL"],
  };

  it("estricta: aceptada, limpia y con la viñeta y las skills esperadas al frente", () => {
    const d = verified(
      [{ ref: "experience-0", bullets: ["Automaticé la carga con SQL", "Armé reportes en Excel"] }],
      ["SQL"],
    );
    expect(checkCvTailorCase(expected, d)).toMatchObject({
      rejected: false,
      unsafe: false,
      strict: true,
      lax: true,
      failures: [],
    });
  });

  it("laxa pero no estricta: la viñeta esperada quedó segunda", () => {
    const d = verified([], ["SQL"]);
    const c = checkCvTailorCase(expected, d);
    expect(c.strict).toBe(false);
    expect(c.lax).toBe(true);
    expect(c.failures[0]).toMatch(/puesto 2/);
  });

  it("una versión descartada no es insegura, pero tampoco acierta", () => {
    expect(checkCvTailorCase(expected, null)).toMatchObject({
      rejected: true,
      unsafe: false,
      strict: false,
      lax: false,
    });
  });

  it("un dato prohibido en una versión aceptada es inseguro y no acierta", () => {
    const d = verified([]);
    const c = checkCvTailorCase({ forbidden: ["excel"] }, d);
    expect(c).toMatchObject({ unsafe: true, strict: false, lax: false });
  });

  it("las skills esperadas fuera de lugar fallan", () => {
    const d = verified([], ["Excel"]);
    expect(checkCvTailorCase({ firstSkills: ["SQL"] }, d).strict).toBe(false);
  });

  it("resume con las cuatro cifras", () => {
    const ok = checkCvTailorCase({}, verified([]));
    const rejected = checkCvTailorCase({}, null);
    const unsafe = checkCvTailorCase({ forbidden: ["excel"] }, verified([]));
    expect(summarizeCvTailorChecks([ok, rejected, unsafe])).toMatchObject({
      n: 3,
      strict: 1,
      lax: 1,
      rejected: 1,
      unsafe: 1,
    });
    expect(summarizeCvTailorChecks([]).strictRate).toBeNull();
  });
});

describe("parseCvTailorGolden", () => {
  it("rechaza un archivo con otra cantidad de casos o con ids repetidos", () => {
    expect(parseCvTailorGolden([]).ok).toBe(false);
    const one = {
      id: "a",
      cv: { displayName: "P", skills: [], languages: [], achievements: [], history: [] },
      job: { title: "T", company: "E", description: "D" },
      expect: {},
    };
    const many = Array.from({ length: CV_TAILOR_GOLDEN_SIZE }, () => one);
    const r = parseCvTailorGolden(many);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/ids repetidos/);
  });

  // El golden vive en evals/ (lo coloca quien integra). Mientras no esté, este caso no corre.
  const candidates = [
    new URL("../../../../evals/fixtures/cv-tailor/golden.json", import.meta.url),
    new URL(
      "../../../../ops/rondas/r20-tanda/R20-04/propuesta/evals/fixtures/cv-tailor/golden.json",
      import.meta.url,
    ),
  ];
  const file = candidates.find((u) => existsSync(u));
  it.skipIf(!file)(
    "el golden del repo tiene 8 casos válidos y cada referencia existe en su CV",
    () => {
      const parsed = parseCvTailorGolden(JSON.parse(readFileSync(file!, "utf8")));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      for (const g of parsed.value) {
        const d = buildCvDocument(
          {
            ...g.cv,
            skills: g.cv.skills.map((s) => ({ name: s.name, category: s.category ?? null })),
          },
          { lang: "es", includeEmail: false },
        );
        if (g.expect.firstBullet) {
          const ref = g.expect.firstBullet.ref;
          const block = (d.sections.find((s) => s.id === ref.split("-")[0])?.blocks ?? [])[
            Number(ref.split("-")[1])
          ];
          expect(block, `${g.id}: la referencia ${ref} no existe`).toBeDefined();
          expect(
            block!.bullets.some((b) =>
              b.toLowerCase().includes(g.expect.firstBullet!.contains.toLowerCase()),
            ),
            `${g.id}: ninguna viñeta contiene el fragmento`,
          ).toBe(true);
        }
        for (const f of g.expect.forbidden ?? []) {
          expect(
            JSON.stringify(d).toLowerCase().includes(f.toLowerCase()),
            `${g.id}: lo prohibido «${f}» ya está en el CV de partida`,
          ).toBe(false);
        }
      }
    },
  );
});
