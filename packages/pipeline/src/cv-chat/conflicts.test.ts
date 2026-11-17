import { describe, expect, it } from "vitest";
import { cvConflictOptions, findCvConflict, resolveCvConflict, type CvConflict } from "./conflicts";
import { cvTopicQuestion } from "./questions";
import { parseCvChatState } from "./state-schema";
import {
  initialCvChatState,
  nextCvTopic,
  skipCvTopic,
  type CvChatState,
  type CvWorkDraft,
} from "./state";
import { applyCvModelTurn, cvInterviewTurnSchema } from "./turn";

const MSG =
  "Trabajé en Empresa A como Desarrollador de aplicaciones web, de abril 2025 a febrero 2026.";

function turn(state: CvChatState, message: string, object: Record<string, unknown>) {
  const topic = nextCvTopic(state)!;
  return applyCvModelTurn(state, topic, message, cvInterviewTurnSchema(topic).parse(object));
}

/** Empresa, cargo y fechas ya dichos en el primer mensaje: el próximo tema es «tareas». */
function afterFirstMessage(): CvChatState {
  return turn(initialCvChatState({ target: "AI Engineer" }), MSG, {
    extraction: { organization: "Empresa A", noExperience: false },
    extras: [
      { kind: "title", title: "Desarrollador de aplicaciones web" },
      { kind: "dates", startMonth: "2025-04", endMonth: "2026-02", isCurrent: false },
    ],
    ack: null,
  }).state;
}

describe("contradicción con lo dicho antes (R12-3)", () => {
  it("febrero contra marzo: pregunta «Antes me dijiste febrero…» con dos opciones y no pisa nada", () => {
    const s0 = afterFirstMessage();
    expect(nextCvTopic(s0)?.kind).toBe("duties");
    const msg = "Hacía el front. Ah, y estuve hasta marzo 2026.";
    const out = turn(s0, msg, {
      extraction: { duties: ["Hacía el front"] },
      extras: [{ kind: "dates", startMonth: null, endMonth: "2026-03", isCurrent: false }],
      ack: null,
    });
    const c = out.state.conflict!;
    expect(c).toEqual({
      workIndex: 0,
      field: "endMonth",
      previous: "2026-02",
      proposed: "2026-03",
      source: "said",
    });
    expect(out.state.works[0]?.endMonth).toBe("2026-02");
    expect(cvTopicQuestion(nextCvTopic(out.state)!, out.state)).toBe(
      "Antes me dijiste febrero de 2026, ahora me decís marzo de 2026. ¿Cuál dejo?",
    );
    expect(cvConflictOptions(c).map((o) => o.label)).toEqual(["febrero de 2026", "marzo de 2026"]);
  });

  it("dos cargos distintos para el mismo trabajo", () => {
    const out = turn(
      afterFirstMessage(),
      "Hacía el front. Mi cargo era Desarrollador full stack.",
      {
        extraction: { duties: ["Hacía el front"] },
        extras: [{ kind: "title", title: "Desarrollador full stack" }],
        ack: null,
      },
    );
    expect(out.state.conflict).toMatchObject({
      field: "title",
      previous: "Desarrollador de aplicaciones web",
      proposed: "Desarrollador full stack",
    });
    expect(cvTopicQuestion(nextCvTopic(out.state)!, out.state)).toBe(
      "Antes me dijiste «Desarrollador de aplicaciones web», ahora me decís «Desarrollador full stack». ¿Cuál dejo?",
    );
  });

  it("sin contradicción no hay pregunta extra (mismo dato con otras mayúsculas o tildes, o dato nuevo)", () => {
    const s0 = afterFirstMessage();
    const same = turn(s0, "Hacía el front, era desarrollador de aplicaciones web", {
      extraction: { duties: ["Hacía el front"] },
      extras: [{ kind: "title", title: "desarrollador de aplicaciones web" }],
      ack: null,
    });
    expect(same.state.conflict).toBeNull();
    expect(cvTopicQuestion(nextCvTopic(same.state)!, same.state)).not.toMatch(/Cuál dejo/);
    const plain = turn(s0, "Hacía el front con React", {
      extraction: { duties: ["Hacía el front con React"] },
      ack: null,
    });
    expect(plain.state.conflict).toBeNull();
  });
});

describe("contradicción con lo confirmado en el CV (R12-3)", () => {
  const confirmedWork = {
    kind: "trabajo" as const,
    organization: "Empresa A",
    title: "Desarrollador de aplicaciones web",
    startMonth: "2025-04",
    endMonth: "2026-02",
    bullets: [],
  };
  const work: CvWorkDraft = {
    organization: "Empresa A",
    title: "Desarrollador de aplicaciones web",
    startMonth: "2025-04",
    endMonth: "2026-03",
    isCurrent: false,
    duties: [],
    achievement: null,
  };

  it("«En tu CV figura febrero, acá me decís marzo. ¿Cuál dejo?»", () => {
    const s = { ...initialCvChatState({ target: "x" }), confirmed: [confirmedWork], works: [work] };
    const c = findCvConflict(s, { kind: "dates", key: "w0:dates", workIndex: 0 }, []);
    expect(c).toEqual({
      workIndex: 0,
      field: "endMonth",
      previous: "2026-02",
      proposed: "2026-03",
      source: "confirmed",
    });
    const withC = { ...s, conflict: c };
    expect(cvTopicQuestion({ kind: "duties", key: "w0:duties", workIndex: 0 }, withC)).toBe(
      "En tu CV figura febrero de 2026, acá me decís marzo de 2026. ¿Cuál dejo?",
    );
  });

  it("otra empresa en el CV no es contradicción", () => {
    const s = {
      ...initialCvChatState({ target: "x" }),
      confirmed: [{ ...confirmedWork, organization: "Empresa B" }],
      works: [work],
    };
    expect(findCvConflict(s, { kind: "dates", key: "w0:dates", workIndex: 0 }, [])).toBeNull();
  });
});

describe("la respuesta a la contradicción (chips) (R12-3)", () => {
  const c: CvConflict = {
    workIndex: 0,
    field: "endMonth",
    previous: "2026-02",
    proposed: "2026-03",
    source: "said",
  };
  const withConflict = (): CvChatState => ({ ...afterFirstMessage(), conflict: c });

  it("el chip de la opción nueva la deja; cuenta un turno y sigue el temario", () => {
    const s = withConflict();
    const out = resolveCvConflict(s, "marzo de 2026");
    expect(out.state.works[0]?.endMonth).toBe("2026-03");
    expect(out.state.conflict).toBeNull();
    expect(out.state.turns).toBe(s.turns + 1);
    expect(out.ack).toBe("Listo, dejo marzo de 2026.");
    expect(nextCvTopic(out.state)?.kind).toBe("duties");
  });

  it("el chip de la anterior la conserva; escrito a mano («marzo») también vale", () => {
    expect(resolveCvConflict(withConflict(), "febrero de 2026").state.works[0]?.endMonth).toBe(
      "2026-02",
    );
    expect(resolveCvConflict(withConflict(), "Marzo").state.works[0]?.endMonth).toBe("2026-03");
  });

  it("una respuesta que no es ninguna de las dos conserva lo anterior y no vuelve a preguntar", () => {
    const out = resolveCvConflict(withConflict(), "no sé");
    expect(out.state.works[0]?.endMonth).toBe("2026-02");
    expect(out.state.conflict).toBeNull();
  });

  it("un fin anterior al inicio no se acepta", () => {
    const s = { ...withConflict(), conflict: { ...c, proposed: "2024-01" } };
    expect(resolveCvConflict(s, "enero de 2024").state.works[0]?.endMonth).toBe("2026-02");
  });

  it("«Saltear» descarta la contradicción y conserva lo anterior", () => {
    const s = withConflict();
    const out = skipCvTopic(s, nextCvTopic(s)!);
    expect(out.conflict).toBeNull();
    expect(out.works[0]?.endMonth).toBe("2026-02");
    expect(out.answered).toEqual(s.answered);
  });

  it("el estado con la contradicción pendiente vuelve del navegador; uno sin el campo también", () => {
    const s = withConflict();
    expect(parseCvChatState(JSON.parse(JSON.stringify(s)))?.conflict).toEqual(c);
    const { conflict: _omit, ...old } = s;
    expect(parseCvChatState(old)?.conflict).toBeNull();
  });
});
