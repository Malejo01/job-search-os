import { describe, expect, it } from "vitest";
import raw from "../../test/fixtures/cv-chat/transcripcion-17-11.json";
import {
  cvBaselineFactKept,
  cvBaselineFixtureSchema,
  runCvChatBaseline,
  type CvBaselineFixture,
} from "./baseline";
import { initialCvChatState } from "./state";

const fixture: CvBaselineFixture = cvBaselineFixtureSchema.parse(raw);

function run(version: string) {
  const r = runCvChatBaseline(fixture, version);
  if (!r.ok) throw new Error(`línea de base ${version}: ${JSON.stringify(r.error)}`);
  return r.value;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)} %`;

describe("línea de base del chat de CV con la transcripción del 17/11 (R12-2)", () => {
  it("la fixture es pública y ficticia: sin emails, teléfonos ni links", () => {
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/@|https?:\/\/|\+?\d{2}[\s-]?\d{4}[\s-]?\d{4}/);
    expect(text).toContain("Empresa A");
  });

  it("antes (esquema de un tema, v2): se pierden los proyectos y el segundo puesto, y repregunta cargo, fechas y tareas", () => {
    const r = run("v2");
    expect(r.turns.map((t) => t.topic)).toEqual([
      "target",
      "organization",
      "title",
      "dates",
      "duties",
      "achievement",
      "more_work",
      "education",
      "certifications",
      "skills",
      "languages",
      "links",
    ]);
    expect(r.turns.filter((t) => t.repeated).map((t) => t.topic)).toEqual([
      "title",
      "dates",
      "duties",
    ]);
    expect(r.lost.sort()).toEqual(
      ["proyecto-1", "proyecto-2", "proyecto-3", "proyecto-4", "puesto-2"].sort(),
    );
    expect(r.factsSaid).toBe(18);
    expect(r.questions).toBe(12);
    console.info(
      `[línea de base v2] datos perdidos ${r.lost.length}/${r.factsSaid} (${pct(r.lostRatio)}) · ` +
        `preguntas repetidas ${r.repeated}/${r.questions} (${pct(r.repeatedRatio)})`,
    );
  });

  it("después de R12-2 (extras, v3): no se pierde ningún dato y no repregunta nada ya dicho", () => {
    const before = run("v2");
    const r = run("v3");
    // Empresa, cargo, fechas y tareas en un mensaje: no vuelve a preguntar cargo, fechas ni tareas.
    // El mensaje de los proyectos llega cuando pregunta el logro; como no trae logro, repregunta (modelo).
    expect(r.turns.map((t) => t.topic)).toEqual([
      "target",
      "organization",
      "achievement",
      "achievement",
      "more_work",
      "education",
      "certifications",
      "skills",
      "languages",
      "links",
    ]);
    expect(r.lost).toEqual([]);
    expect(r.repeated).toBe(0);
    expect(r.factsSaid).toBe(before.factsSaid);
    expect(r.state.projects.map((p) => p.name)).toEqual([
      "Proyecto 1",
      "Proyecto 2",
      "Proyecto 3",
      "Proyecto 4",
    ]);
    // una sola repregunta del logro (la decide el código; el texto es del modelo)
    expect(r.state.followUps["w0:achievement"]).toBe(1);
    expect(r.lostRatio).toBeLessThan(before.lostRatio);
    expect(r.repeatedRatio).toBeLessThan(before.repeatedRatio);
    console.info(
      `[después de R12-2 v3] datos perdidos ${r.lost.length}/${r.factsSaid} (${pct(r.lostRatio)}) · ` +
        `preguntas repetidas ${r.repeated}/${r.questions} (${pct(r.repeatedRatio)})`,
    );
  });

  it("una respuesta grabada que falta se informa, no se inventa", () => {
    const broken: CvBaselineFixture = {
      ...fixture,
      mensajes: fixture.mensajes.map((m) => (m.id === "m2" ? { ...m, respuestas: {} } : m)),
    };
    expect(runCvChatBaseline(broken, "v2")).toMatchObject({
      ok: false,
      error: { kind: "missing_response", messageId: "m2" },
    });
  });

  it("una respuesta grabada fuera de esquema se informa", () => {
    const broken: CvBaselineFixture = {
      ...fixture,
      mensajes: fixture.mensajes.map((m) =>
        m.id === "m1"
          ? { ...m, respuestas: { v2: { target: { extraction: { target: "x", extra: 1 } } } } }
          : m,
      ),
    };
    expect(runCvChatBaseline(broken, "v2")).toMatchObject({
      ok: false,
      error: { kind: "schema", messageId: "m1" },
    });
  });

  it("un hecho cuenta con cualquiera de sus valores y sin importar mayúsculas ni tildes", () => {
    const s = {
      ...initialCvChatState({ target: "AI Engineer / Full Stack" }),
      skills: ["typescript"],
    };
    expect(cvBaselineFactKept(s, { campo: "target", valores: ["full stack"] })).toBe(true);
    expect(cvBaselineFactKept(s, { campo: "skill", valores: ["TypeScript"] })).toBe(true);
    expect(cvBaselineFactKept(s, { campo: "skill", valores: ["Python"] })).toBe(false);
    expect(cvBaselineFactKept(s, { campo: "project", valores: ["Proyecto 1"] })).toBe(false);
  });
});
