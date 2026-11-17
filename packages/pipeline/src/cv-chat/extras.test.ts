import { describe, expect, it } from "vitest";
import {
  applyCvExtras,
  CV_CHAT_MAX_PROJECTS,
  CV_EXTRA_SCHEMA,
  usableCvExtras,
  type CvExtra,
} from "./extras";
import { parseCvChatState } from "./state-schema";
import {
  applyCvAnswer,
  CV_PROJECT_DEFAULT_ROLE,
  cvChatHistory,
  cvChecklistProgress,
  initialCvChatState,
  nextCvTopic,
  type CvChatState,
} from "./state";
import { applyCvModelTurn, cvInterviewTurnSchema } from "./turn";

const MSG =
  "Trabajé en Empresa A como Desarrollador de aplicaciones web, de abril 2025 a febrero 2026. Hacía el front con React y el back con Node.";

const extrasOfMsg: CvExtra[] = [
  { kind: "title", title: "Desarrollador de aplicaciones web" },
  { kind: "dates", startMonth: "2025-04", endMonth: "2026-02", isCurrent: false },
  { kind: "duties", duties: ["Hacía el front con React y el back con Node"] },
];

/** Estado con el puesto ya dicho: el próximo tema es la empresa del primer trabajo. */
const atOrganization = (): CvChatState => initialCvChatState({ target: "AI Engineer" });

function turn(state: CvChatState, message: string, object: Record<string, unknown>) {
  const topic = nextCvTopic(state)!;
  const parsed = cvInterviewTurnSchema(topic).parse(object);
  return applyCvModelTurn(state, topic, message, parsed).state;
}

describe("esquema de un extra (R12-2)", () => {
  it("valida cada tipo y rechaza campos de más, meses inválidos y fechas al revés", () => {
    expect(CV_EXTRA_SCHEMA.safeParse({ kind: "title", title: "Analista" }).success).toBe(true);
    expect(CV_EXTRA_SCHEMA.safeParse({ kind: "title", title: "Analista", x: 1 }).success).toBe(
      false,
    );
    expect(
      CV_EXTRA_SCHEMA.safeParse({
        kind: "dates",
        startMonth: "2025-13",
        endMonth: null,
        isCurrent: false,
      }).success,
    ).toBe(false);
    expect(
      CV_EXTRA_SCHEMA.safeParse({
        kind: "dates",
        startMonth: "2026-02",
        endMonth: "2025-04",
        isCurrent: false,
      }).success,
    ).toBe(false);
    expect(CV_EXTRA_SCHEMA.safeParse({ kind: "skills", skills: ["SQL"] }).success).toBe(false);
  });

  it("`extras` es opcional en el turno (default []) y un extra roto se descarta sin tirar el turno", () => {
    const topic = nextCvTopic(atOrganization())!;
    const schema = cvInterviewTurnSchema(topic);
    const base = { extraction: { organization: "Empresa A", noExperience: false }, ack: null };
    expect(schema.parse(base).extras).toEqual([]);
    const parsed = schema.parse({
      ...base,
      extras: [{ kind: "title", title: "Analista" }, { kind: "title", title: "" }, { foo: 1 }],
    });
    expect(parsed.extras).toEqual([{ kind: "title", title: "Analista" }, null, null]);
  });
});

describe("usableCvExtras: grounding y datos sensibles (R12-2)", () => {
  it("un extra con un dato que el mensaje no trae se descarta entero; el resto pasa", () => {
    const out = usableCvExtras(
      [
        ...extrasOfMsg,
        { kind: "title", title: "Gerente de Empresa Z" },
        { kind: "achievement", achievement: "Facturé 40 millones" },
      ],
      MSG,
    );
    expect(out).toEqual(extrasOfMsg);
  });

  it("un año que el mensaje no dice descarta el extra de fechas", () => {
    const out = usableCvExtras(
      [{ kind: "dates", startMonth: "2010-01", endMonth: null, isCurrent: true }],
      MSG,
    );
    expect(out).toEqual([]);
  });

  it("un extra con un dato sensible se descarta entero", () => {
    const msg = "Trabajé en Empresa A; soy casada y tengo dos hijos. Era Analista.";
    const out = usableCvExtras(
      [
        { kind: "achievement", achievement: "Soy casada y tengo dos hijos" },
        { kind: "title", title: "Analista" },
      ],
      msg,
    );
    expect(out).toEqual([{ kind: "title", title: "Analista" }]);
  });

  it("proyecto: el link tiene que estar en el mensaje y ser https; si no, se descarta el proyecto", () => {
    const msg = "Hice Proyecto 1 con Python, está en https://ejemplo.test/proyecto-1";
    const p = {
      kind: "project" as const,
      name: "Proyecto 1",
      role: null,
      description: null,
      stack: ["Python"],
      link: "https://ejemplo.test/proyecto-1",
    };
    expect(usableCvExtras([p], msg)).toEqual([p]);
    expect(usableCvExtras([{ ...p, link: "https://otro.test/x" }], msg)).toEqual([]);
    expect(usableCvExtras([{ ...p, link: "http://ejemplo.test/proyecto-1" }], msg)).toEqual([]);
    expect(usableCvExtras([{ ...p, stack: ["Kubernetes"] }], msg)).toEqual([]);
  });

  it("nunca más de 10 extras", () => {
    const many = Array.from({ length: 14 }, () => extrasOfMsg[0]!);
    expect(usableCvExtras(many, MSG).length).toBeLessThanOrEqual(10);
  });
});

describe("empresa, cargo y fechas en un mensaje no se vuelven a preguntar (R12-2)", () => {
  it("con extras, el próximo tema es el logro: ni cargo, ni fechas, ni tareas", () => {
    const s = turn(atOrganization(), MSG, {
      extraction: { organization: "Empresa A", noExperience: false },
      extras: extrasOfMsg,
      ack: null,
      followUp: null,
    });
    expect(s.works[0]).toMatchObject({
      organization: "Empresa A",
      title: "Desarrollador de aplicaciones web",
      startMonth: "2025-04",
      endMonth: "2026-02",
      isCurrent: false,
      duties: ["Hacía el front con React y el back con Node"],
    });
    expect(nextCvTopic(s)).toMatchObject({ kind: "achievement", workIndex: 0 });
  });

  it("sin extras (respuesta de v2) se comporta como antes: pregunta el cargo", () => {
    const s = turn(atOrganization(), MSG, {
      extraction: { organization: "Empresa A", noExperience: false },
      ack: null,
    });
    expect(nextCvTopic(s)).toMatchObject({ kind: "title", workIndex: 0 });
  });

  it("fechas sin fin y sin «sigo ahí» se guardan, pero el tema de fechas se pregunta igual", () => {
    const s = turn(atOrganization(), "Trabajé en Empresa A desde 2025 como Analista", {
      extraction: { organization: "Empresa A", noExperience: false },
      extras: [
        { kind: "title", title: "Analista" },
        { kind: "dates", startMonth: "2025-01", endMonth: null, isCurrent: false },
      ],
      ack: null,
    });
    expect(s.works[0]?.startMonth).toBe("2025-01");
    expect(nextCvTopic(s)).toMatchObject({ kind: "dates", workIndex: 0 });
  });

  it("un extra no pisa lo que ya estaba cargado (eso lo resuelve la pregunta de contradicción)", () => {
    let s = turn(atOrganization(), MSG, {
      extraction: { organization: "Empresa A", noExperience: false },
      extras: extrasOfMsg,
      ack: null,
    });
    s = applyCvExtras(s, nextCvTopic(s)!, [{ kind: "title", title: "Otro cargo" }]);
    expect(s.works[0]?.title).toBe("Desarrollador de aplicaciones web");
  });

  it("«no tengo experiencia» ignora los extras de trabajo", () => {
    const s = turn(atOrganization(), "No tengo experiencia, pero quiero ser Analista", {
      extraction: { organization: null, noExperience: true },
      extras: [{ kind: "title", title: "Analista" }],
      ack: null,
    });
    expect(s.workDone).toBe(true);
    expect(s.works).toEqual([]);
  });

  it("al sumar otro trabajo, los extras van al trabajo nuevo", () => {
    let s = turn(atOrganization(), MSG, {
      extraction: { organization: "Empresa A", noExperience: false },
      extras: extrasOfMsg,
      ack: null,
    });
    s = applyCvAnswer(s, nextCvTopic(s)!, { achievement: null }); // logro: nada
    expect(nextCvTopic(s)).toMatchObject({ kind: "more_work", workIndex: 1 });
    s = turn(s, "Sí, antes fui Analista en Empresa B", {
      extraction: { more: true },
      extras: [
        { kind: "organization", organization: "Empresa B" },
        { kind: "title", title: "Analista" },
      ],
      ack: null,
    });
    expect(s.works[1]).toMatchObject({ organization: "Empresa B", title: "Analista" });
    expect(nextCvTopic(s)).toMatchObject({ kind: "dates", workIndex: 1 });
  });
});

describe("proyectos dichos en cualquier tema quedan como entrada `proyecto` (R12-2)", () => {
  const msg =
    "Desarrollador full stack. Además hice Proyecto 1, un asistente con Next.js, y Proyecto 2, un bot con RAG.";
  const projects: CvExtra[] = [
    {
      kind: "project",
      name: "Proyecto 1",
      role: null,
      description: "Un asistente con Next.js",
      stack: ["Next.js"],
      link: null,
    },
    {
      kind: "project",
      name: "Proyecto 2",
      role: null,
      description: "Un bot con RAG",
      stack: ["RAG"],
      link: null,
    },
  ];

  it("en el tema «cargo»: se guarda el cargo y salen dos entradas de proyecto", () => {
    let s = turn(atOrganization(), "Trabajé en Empresa A", {
      extraction: { organization: "Empresa A", noExperience: false },
      ack: null,
    });
    s = turn(s, msg, {
      extraction: { title: "Desarrollador full stack" },
      extras: projects,
      ack: null,
    });
    expect(s.works[0]?.title).toBe("Desarrollador full stack");
    const p = cvChatHistory(s).filter((h) => h.kind === "proyecto");
    expect(p).toEqual([
      {
        kind: "proyecto",
        organization: "Proyecto 1",
        title: CV_PROJECT_DEFAULT_ROLE,
        startMonth: null,
        endMonth: null,
        bullets: ["Un asistente con Next.js", "Stack: Next.js"],
        link: null,
      },
      {
        kind: "proyecto",
        organization: "Proyecto 2",
        title: CV_PROJECT_DEFAULT_ROLE,
        startMonth: null,
        endMonth: null,
        bullets: ["Un bot con RAG", "Stack: RAG"],
        link: null,
      },
    ]);
  });

  it("también en un tema de lista (skills) y sin duplicar el mismo proyecto", () => {
    let s: CvChatState = { ...initialCvChatState({ target: "AI Engineer" }), workDone: true };
    expect(nextCvTopic(s)?.kind).toBe("education");
    s = applyCvExtras(s, nextCvTopic(s)!, projects);
    s = applyCvExtras(s, nextCvTopic(s)!, [projects[0]!]);
    expect(s.projects.map((p) => p.name)).toEqual(["Proyecto 1", "Proyecto 2"]);
  });

  it(`tope de ${CV_CHAT_MAX_PROJECTS} proyectos`, () => {
    let s = atOrganization();
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...projects[0]!,
      name: `Proyecto ${i + 1}`,
    })) as CvExtra[];
    s = applyCvExtras(s, nextCvTopic(s)!, many);
    expect(s.projects).toHaveLength(CV_CHAT_MAX_PROJECTS);
  });

  it("el estado con proyectos vuelve del navegador y uno sin `projects` (versión anterior) también", () => {
    let s = atOrganization();
    s = applyCvExtras(s, nextCvTopic(s)!, projects);
    expect(parseCvChatState(JSON.parse(JSON.stringify(s)))?.projects).toEqual(s.projects);
    const { projects: _omit, ...old } = s;
    expect(parseCvChatState(old)?.projects).toEqual([]);
    expect(
      parseCvChatState({ ...s, projects: [{ ...s.projects[0]!, link: "http://x.test/a" }] }),
    ).toBeNull();
  });

  it("los proyectos no cambian el avance del checklist", () => {
    const s = atOrganization();
    expect(cvChecklistProgress(applyCvExtras(s, nextCvTopic(s)!, projects))).toEqual(
      cvChecklistProgress(s),
    );
  });
});
