import { describe, expect, it } from "vitest";
import skills from "../../../db/seeds/skills.json";
import {
  MAX_CUSTOM_SKILLS,
  customSkillKey,
  customSkillRejectionText,
  parseCustomSkillsForm,
  parseRemoveCustomIds,
  validateCustomSkillName,
} from "./custom-skills";

const taxonomy = skills as { slug: string; name: string; aliases: string[] }[];
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("validateCustomSkillName", () => {
  it("acepta un nombre normal y lo deja con trim y espacios colapsados", () => {
    const r = validateCustomSkillName("  Herramienta   Ficticia  ", taxonomy);
    expect(r).toEqual({ ok: true, name: "Herramienta Ficticia", key: "herramienta ficticia" });
  });

  it("largo: de 2 a 40 caracteres", () => {
    expect(validateCustomSkillName("a", taxonomy)).toEqual({ ok: false, reason: "corto" });
    expect(validateCustomSkillName("   ", taxonomy)).toEqual({ ok: false, reason: "corto" });
    expect(validateCustomSkillName("ab", taxonomy).ok).toBe(true);
    expect(validateCustomSkillName("x".repeat(40), taxonomy).ok).toBe(true);
    expect(validateCustomSkillName("x".repeat(41), taxonomy)).toEqual({
      ok: false,
      reason: "largo",
    });
  });

  it("el largo se mide después de colapsar los espacios", () => {
    const spaced = `${"a".repeat(20)}${" ".repeat(30)}${"b".repeat(15)}`;
    expect(validateCustomSkillName(spaced, taxonomy).ok).toBe(true);
  });

  it("rechaza caracteres de control, invisibles, < y >", () => {
    for (const bad of ["Hola\nmundo", "Hola\tmundo", "Hola\u0000", "<b>x</b>", "a > b", "ab​cd"]) {
      expect(validateCustomSkillName(bad, taxonomy), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "caracteres",
      });
    }
  });

  it("rechaza links", () => {
    for (const bad of [
      "https://ejemplo.test/x",
      "https://x.com",
      "www.ejemplo.com",
      "www.algo.com",
      "algo.com/ruta",
      "persona@example.com",
      "ftp://x",
    ]) {
      expect(validateCustomSkillName(bad, taxonomy), bad).toEqual({ ok: false, reason: "url" });
    }
  });

  it("no confunde con un link nombres con punto como Vue.js", () => {
    for (const good of ["Svelte.js", "Socket.io", "Node.js", "D3.js", "ASP.NET"]) {
      // Sin taxonomía: algunos (Node.js) ya están en la lista y darían `en_taxonomia`, no `url`
      expect(validateCustomSkillName(good, []).ok, good).toBe(true);
    }
  });

  it("rechaza lo que ya está en la taxonomía, por nombre, slug o alias, y dice cuál usar", () => {
    const cases: [string, string][] = [
      ["Figma", "figma"],
      ["figma", "figma"],
      ["FIGJAM", "figma"],
      ["git", "git"],
      ["GitHub", "git"],
      ["Gitlab", "git"],
      ["Git / GitHub", "git"],
      ["Canva", "canva"],
      ["mailchimp", "mailchimp"],
      ["Redes", "redes_it"],
      ["Accesibilidad", "accessibility"],
      ["investigacion de usuarios", "ux_research"],
    ];
    for (const [name, slug] of cases) {
      const r = validateCustomSkillName(name, taxonomy);
      expect(r.ok, name).toBe(false);
      if (!r.ok) {
        expect(r.reason, name).toBe("en_taxonomia");
        expect(r.existing?.slug, name).toBe(slug);
      }
    }
  });

  it("el texto de rechazo nombra la skill existente", () => {
    const r = validateCustomSkillName("github", taxonomy);
    if (r.ok) throw new Error("debería rechazar");
    expect(customSkillRejectionText(r)).toContain("Git / GitHub");
  });

  it("acepta nombres con acentos, números y símbolos comunes", () => {
    for (const ok of ["Diseño 3D", "C++", "Power Apps", "Atención al cliente"]) {
      expect(validateCustomSkillName(ok, taxonomy).ok, ok).toBe(true);
    }
  });
});

describe("customSkillRejectionText", () => {
  it("un texto para cada motivo", () => {
    expect(customSkillRejectionText({ ok: false, reason: "corto" })).toBe(
      "El nombre tiene que tener al menos 2 letras.",
    );
    expect(customSkillRejectionText({ ok: false, reason: "largo" })).toBe(
      "El nombre puede tener hasta 40 caracteres.",
    );
    expect(customSkillRejectionText({ ok: false, reason: "caracteres" })).toContain("< o >");
    expect(customSkillRejectionText({ ok: false, reason: "url" })).toContain("sin links");
  });

  it("en_taxonomia sin `existing` usa un texto genérico", () => {
    expect(customSkillRejectionText({ ok: false, reason: "en_taxonomia" })).toBe(
      "«Esa skill» ya está en la lista: usá esa.",
    );
  });

  it("el texto sale de la validación real, sin eco del valor escrito", () => {
    const r = validateCustomSkillName("<b>Mi Herramienta Rara</b>", []);
    if (r.ok) throw new Error("debería rechazar");
    expect(customSkillRejectionText(r)).not.toContain("Rara");
  });
});

describe("parseCustomSkillsForm · valores ausentes", () => {
  const base = { taxonomy, existing: [] as { id: string; name: string }[] };

  it("sin `remove` en el contexto equivale a no quitar nada", () => {
    expect(
      parseCustomSkillsForm({ "new_name:n1": "Herramienta Ficticia", "new_level:n1": "1" }, base)
        .ok,
    ).toBe(true);
  });

  it("nombre o nivel con valor undefined se tratan como vacíos", () => {
    expect(parseCustomSkillsForm({ "new_name:n1": undefined, "new_level:n1": "1" }, base)).toEqual({
      ok: false,
      field: "new_name:n1",
    });
    expect(
      parseCustomSkillsForm(
        { "new_name:n1": "Herramienta Ficticia", "new_level:n1": undefined },
        base,
      ),
    ).toEqual({ ok: false, field: "new_level:n1" });
    expect(parseCustomSkillsForm({ [`clevel:${ID_A}`]: undefined }, base)).toEqual({
      ok: true,
      updates: [],
      additions: [],
    });
  });

  it("clevel con espacios alrededor del nivel se recorta", () => {
    const r = parseCustomSkillsForm(
      { [`clevel:${ID_A.toUpperCase()}`]: " 2 " },
      { ...base, existing: [{ id: ID_A, name: "Una" }] },
    );
    expect(r).toEqual({ ok: true, updates: [{ id: ID_A, level: 2 }], additions: [] });
  });
});

describe("customSkillKey", () => {
  it("ignora mayúsculas, acentos y espacios repetidos", () => {
    expect(customSkillKey("  Diseño   GRÁFICO ")).toBe("diseno grafico");
  });
});

describe("parseRemoveCustomIds", () => {
  it("deja solo uuids, sin repetidos", () => {
    expect(parseRemoveCustomIds([ID_A, ID_A, "no-es-uuid", ID_B.toUpperCase()])).toEqual([
      ID_A,
      ID_B,
    ]);
  });
});

describe("parseCustomSkillsForm", () => {
  const ctx = (existing: { id: string; name: string }[] = [], remove: string[] = []) => ({
    taxonomy,
    existing,
    remove,
  });

  it("formulario sin skills propias: ok y vacío", () => {
    expect(parseCustomSkillsForm({ "level:sql": "2" }, ctx())).toEqual({
      ok: true,
      updates: [],
      additions: [],
    });
  });

  it("alta con nombre y nivel", () => {
    const r = parseCustomSkillsForm(
      { "new_name:n1": " Herramienta  Ficticia ", "new_level:n1": "2" },
      ctx(),
    );
    expect(r).toEqual({
      ok: true,
      updates: [],
      additions: [{ name: "Herramienta Ficticia", key: "herramienta ficticia", level: 2 }],
    });
  });

  it("el nivel de una alta es obligatorio y se reporta en su campo", () => {
    expect(parseCustomSkillsForm({ "new_name:n1": "Herramienta Ficticia" }, ctx())).toEqual({
      ok: false,
      field: "new_level:n1",
    });
    expect(
      parseCustomSkillsForm({ "new_name:n1": "Herramienta Ficticia", "new_level:n1": "4" }, ctx()),
    ).toEqual({ ok: false, field: "new_level:n1" });
  });

  it("nombre inválido: el campo, sin devolver el valor", () => {
    const r = parseCustomSkillsForm({ "new_name:n1": "<script>", "new_level:n1": "1" }, ctx());
    expect(r).toEqual({ ok: false, field: "new_name:n1" });
    expect(JSON.stringify(r)).not.toContain("script");
  });

  it("una alta que repite una skill de la taxonomía falla en su campo", () => {
    expect(parseCustomSkillsForm({ "new_name:n1": "Canva", "new_level:n1": "1" }, ctx())).toEqual({
      ok: false,
      field: "new_name:n1",
    });
  });

  it("repetidas entre sí o con una ya guardada (sin importar mayúsculas ni acentos)", () => {
    expect(
      parseCustomSkillsForm(
        {
          "new_name:n1": "Diseño 3D",
          "new_level:n1": "1",
          "new_name:n2": "diseno 3d",
          "new_level:n2": "2",
        },
        ctx(),
      ),
    ).toEqual({ ok: false, field: "new_name:n2" });
    expect(
      parseCustomSkillsForm(
        { "new_name:n1": "DISEÑO 3D", "new_level:n1": "1" },
        ctx([{ id: ID_A, name: "Diseño 3d" }]),
      ),
    ).toEqual({ ok: false, field: "new_name:n1" });
  });

  it("si la guardada se quita en el mismo envío, el nombre queda libre", () => {
    const r = parseCustomSkillsForm(
      { "new_name:n1": "Diseño 3D", "new_level:n1": "1" },
      ctx([{ id: ID_A, name: "Diseño 3D" }], [ID_A]),
    );
    expect(r.ok).toBe(true);
  });

  it("cambia el nivel de las guardadas; ignora ajenas, quitadas y vacías", () => {
    const r = parseCustomSkillsForm(
      {
        [`clevel:${ID_A}`]: "3",
        [`clevel:${ID_B}`]: "",
        "clevel:33333333-3333-4333-8333-333333333333": "1",
      },
      ctx([
        { id: ID_A, name: "Una" },
        { id: ID_B, name: "Otra" },
      ]),
    );
    expect(r).toEqual({ ok: true, updates: [{ id: ID_A, level: 3 }], additions: [] });
    const quitada = parseCustomSkillsForm(
      { [`clevel:${ID_A}`]: "3" },
      ctx([{ id: ID_A, name: "Una" }], [ID_A]),
    );
    expect(quitada).toEqual({ ok: true, updates: [], additions: [] });
  });

  it("nivel guardado fuera de rango o id mal formado", () => {
    expect(
      parseCustomSkillsForm({ [`clevel:${ID_A}`]: "9" }, ctx([{ id: ID_A, name: "Una" }])),
    ).toEqual({
      ok: false,
      field: `clevel:${ID_A}`,
    });
    expect(parseCustomSkillsForm({ "clevel:x": "1" }, ctx())).toEqual({
      ok: false,
      field: "custom_form",
    });
    expect(
      parseCustomSkillsForm({ "new_name:Mal Id": "Algo", "new_level:Mal Id": "1" }, ctx()),
    ).toEqual({
      ok: false,
      field: "custom_form",
    });
  });

  it("tope de 30 por persona, contando lo guardado y descontando lo que se quita", () => {
    const existing = Array.from({ length: MAX_CUSTOM_SKILLS }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Propia ${i}`,
    }));
    const add = { "new_name:n1": "Una más", "new_level:n1": "1" };
    expect(parseCustomSkillsForm(add, ctx(existing))).toEqual({ ok: false, field: "custom_max" });
    expect(parseCustomSkillsForm(add, ctx(existing, [existing[0]!.id])).ok).toBe(true);
    expect(parseCustomSkillsForm(add, ctx(existing.slice(1))).ok).toBe(true);
  });

  it("rechaza un envío con una cantidad absurda de campos", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < MAX_CUSTOM_SKILLS * 3 + 1; i++) raw[`new_level:k${i}`] = "1";
    expect(parseCustomSkillsForm(raw, ctx())).toEqual({ ok: false, field: "custom_form" });
  });
});
