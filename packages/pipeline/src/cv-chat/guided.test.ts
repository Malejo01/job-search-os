import { describe, expect, it } from "vitest";
import { parseCvChatState } from "./state-schema";
import { cvTopicQuestion } from "./questions";
import {
  applyCvAnswer,
  cvChecklistProgress,
  initialCvChatState,
  nextCvTopic,
  skipCvTopic,
  type CvChatState,
} from "./state";
import {
  CV_UI_TOPICS,
  cvCanFinish,
  cvLocalAnswer,
  cvPendingTopics,
  cvReopenTopic,
  cvTopicsProgress,
  cvUiTopicOf,
} from "./guided";
import {
  CV_SOFT_MAX,
  CV_WORK_DUTIES_MAX,
  cvAllSkills,
  cvSoftBulletStatus,
  cvSoftDecide,
  cvSoftProposals,
  cvSummaryCheck,
  cvSummaryChoose,
  cvSummaryDraft,
  cvSummaryFinal,
  pickCvChatLinks,
} from "./guided-text";

/**
 * Flujo guiado de la R33 (R33-03 y R33-04): avance como lista de temas, «Terminar y armar» con datos
 * suficientes, volver a lo salteado, resumen profesional y habilidades blandas por situaciones. Datos
 * inventados. El CV no inventa: todo lo que sale de acá sale de las palabras de la persona.
 */
const guided = (seed: Parameters<typeof initialCvChatState>[0] = {}) =>
  initialCvChatState({ guided: true, ...seed });

/** Responde el tema pendiente con la respuesta de su tipo. */
function answer(s: CvChatState, raw: unknown): CvChatState {
  const t = nextCvTopic(s);
  if (!t) throw new Error("sin tema");
  return applyCvAnswer(s, t, raw);
}
const say = (text: string | null) => ({ answer: text });

describe("temario guiado", () => {
  it("sin la marca `guided` el temario es el de siempre (no hay resumen ni situaciones)", () => {
    const s = initialCvChatState({ target: "Puesto A" });
    expect(s.guided).toBe(false);
    expect(nextCvTopic(s)?.kind).toBe("organization");
  });

  it("con `guided`: puesto, tres preguntas del resumen y después la experiencia", () => {
    let s = guided();
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      kinds.push(nextCvTopic(s)!.kind);
      s = answer(s, i === 0 ? { target: "Puesto A" } : say("algo"));
    }
    expect(kinds).toEqual(["target", "summary_experience", "summary_goal", "summary_strengths"]);
    expect(nextCvTopic(s)?.kind).toBe("organization");
  });

  it("las situaciones de habilidades blandas van después de las herramientas y antes de idiomas", () => {
    let s = guided({ target: "Puesto A" });
    const order: string[] = [];
    let guard = 0;
    while (nextCvTopic(s) && guard++ < 40) {
      const t = nextCvTopic(s)!;
      order.push(t.kind);
      s = skipCvTopic(s, t);
    }
    expect(order).toEqual([
      "summary_experience",
      "summary_goal",
      "summary_strengths",
      "organization",
      "education",
      "certifications",
      "skills",
      "soft_lead",
      "soft_problem",
      "soft_clients",
      "soft_organize",
      "languages",
      "links",
    ]);
  });

  it("las preguntas nuevas salen de las plantillas del informe", () => {
    const s = guided({ target: "Puesto A" });
    const q = (kind: Parameters<typeof cvTopicQuestion>[0]["kind"]) =>
      cvTopicQuestion({ kind, key: kind, workIndex: null }, s);
    expect(q("summary_experience")).toBe("¿Hace cuánto trabajás en esto y en qué áreas?");
    expect(q("summary_goal")).toContain("próximo trabajo");
    expect(q("summary_strengths")).toContain("dos o tres cosas");
    expect(q("soft_lead")).toContain("coordinaste personas o capacitaste");
    expect(q("soft_problem")).toContain("problema resolviste");
    expect(q("soft_clients")).toContain("clientes u otras áreas");
    expect(q("soft_organize")).toContain("organizado o mejorado");
    // nunca la pregunta directa por habilidades blandas
    for (const k of ["soft_lead", "soft_problem", "soft_clients", "soft_organize"] as const) {
      expect(q(k).toLowerCase()).not.toContain("habilidades blandas");
    }
  });

  it("sin experiencia, la pregunta de estudios ofrece proyectos, voluntariado y cursos (C-14)", () => {
    let s = guided({ target: "Puesto A" });
    for (let i = 0; i < 3; i++) s = skipCvTopic(s, nextCvTopic(s)!);
    s = answer(s, { organization: null, noExperience: true });
    const t = nextCvTopic(s)!;
    expect(t.kind).toBe("education");
    const q = cvTopicQuestion(t, s);
    for (const w of ["proyectos", "voluntariado", "cursos"]) expect(q).toContain(w);
    expect(q.toLowerCase()).not.toContain("falló");
  });
});

describe("el avance es una lista de 7 temas", () => {
  it("son siempre los 7 del informe, en orden", () => {
    expect(CV_UI_TOPICS).toEqual([
      "puesto",
      "resumen",
      "experiencia",
      "estudios",
      "habilidades",
      "idiomas",
      "links",
    ]);
    expect(cvTopicsProgress(guided()).map((t) => t.topic)).toEqual([...CV_UI_TOPICS]);
    expect(cvChecklistProgress(guided()).total).toBe(7);
  });

  it("el actual está marcado, los completados tildados y el resto pendientes", () => {
    let s = guided({ target: "Puesto A" });
    expect(cvTopicsProgress(s).map((t) => t.status)).toEqual([
      "done",
      "current",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    for (let i = 0; i < 3; i++) s = answer(s, say("algo"));
    const st = cvTopicsProgress(s).map((t) => t.status);
    expect(st.slice(0, 3)).toEqual(["done", "done", "current"]);
    expect(cvChecklistProgress(s)).toEqual({ done: 2, total: 7 });
  });

  it("un tema salteado queda como «skipped», no como hecho", () => {
    let s = guided({ target: "Puesto A" });
    s = skipCvTopic(s, nextCvTopic(s)!); // summary_experience
    const st = cvTopicsProgress(s);
    expect(st[1]!.status).toBe("current"); // todavía quedan preguntas del resumen
    s = skipCvTopic(s, nextCvTopic(s)!);
    s = skipCvTopic(s, nextCvTopic(s)!);
    expect(cvTopicsProgress(s)[1]!.status).toBe("skipped");
    expect(cvPendingTopics(s)).toContain("resumen");
  });

  it("estudios y certificaciones son un solo tema; habilidades incluye las situaciones", () => {
    let s = guided({ target: "Puesto A" });
    for (let i = 0; i < 3; i++) s = answer(s, say("algo"));
    s = answer(s, { organization: null, noExperience: true });
    expect(cvUiTopicOf(nextCvTopic(s)!)).toBe("estudios");
    s = answer(s, { entries: [] });
    expect(cvUiTopicOf(nextCvTopic(s)!)).toBe("estudios");
    s = answer(s, { entries: [] });
    expect(cvUiTopicOf(nextCvTopic(s)!)).toBe("habilidades");
    s = answer(s, { skills: ["Excel"] });
    expect(nextCvTopic(s)!.kind).toBe("soft_lead");
    expect(cvUiTopicOf(nextCvTopic(s)!)).toBe("habilidades");
    expect(cvTopicsProgress(s)[4]!.status).toBe("current");
  });

  it("en el flujo anterior son los mismos 7 contadores de siempre", () => {
    const s = initialCvChatState({ target: "Puesto A" });
    expect(cvChecklistProgress(s)).toEqual({ done: 1, total: 7 });
  });
});

describe("«Terminar y armar» con datos suficientes", () => {
  it("sin ningún trabajo, proyecto ni estudio todavía no alcanza", () => {
    expect(cvCanFinish(guided({ target: "Puesto A" }))).toBe(false);
  });

  it("alcanza con un trabajo con empresa y cargo, un estudio o un proyecto", () => {
    let s = guided({ target: "Puesto A" });
    for (let i = 0; i < 3; i++) s = answer(s, say("algo"));
    s = answer(s, { organization: "Empresa A", noExperience: false });
    expect(cvCanFinish(s)).toBe(false); // todavía sin cargo
    s = answer(s, { title: "Cargo A" });
    expect(cvCanFinish(s)).toBe(true);
    const estudio = {
      ...guided(),
      education: [
        { institution: "Institución A", title: "Título A", startMonth: null, endMonth: null },
      ],
    };
    expect(cvCanFinish(estudio)).toBe(true);
    const proyecto = {
      ...guided(),
      projects: [{ name: "Proyecto A", role: null, description: null, stack: [], link: null }],
    };
    expect(cvCanFinish(proyecto)).toBe(true);
  });

  it("«Falta» lista los temas pendientes, en orden, sin contar los hechos", () => {
    let s = guided({ target: "Puesto A" });
    for (let i = 0; i < 3; i++) s = answer(s, say("algo"));
    expect(cvPendingTopics(s)).toEqual([
      "experiencia",
      "estudios",
      "habilidades",
      "idiomas",
      "links",
    ]);
  });
});

describe("volver a lo salteado (C-07)", () => {
  it("reabrir un tema salteado lo vuelve a preguntar sin tocar lo ya contestado", () => {
    let s = guided({ target: "Puesto A" });
    s = answer(s, say("Tres años en administración"));
    s = skipCvTopic(s, nextCvTopic(s)!); // summary_goal salteada
    s = answer(s, say("Ordeno y presento información"));
    expect(nextCvTopic(s)!.kind).toBe("organization");
    expect(cvTopicsProgress(s)[1]!.status).toBe("skipped");

    const back = cvReopenTopic(s, "resumen");
    expect(nextCvTopic(back)!.kind).toBe("summary_goal");
    expect(back.summary.experience).toBe("Tres años en administración");
    expect(back.summary.strengths).toBe("Ordeno y presento información");
    // contestarla la saca de las salteadas y se sigue donde se estaba
    const done = answer(back, say("Un equipo chico"));
    expect(done.skipped).not.toContain("summary_goal");
    expect(nextCvTopic(done)!.kind).toBe("organization");
  });

  it("reabrir la experiencia salteada vuelve a preguntar la empresa", () => {
    let s = guided({ target: "Puesto A" });
    for (let i = 0; i < 3; i++) s = answer(s, say("algo"));
    s = skipCvTopic(s, nextCvTopic(s)!); // empresa salteada: sigue sin experiencia
    expect(nextCvTopic(s)!.kind).toBe("education");
    expect(cvTopicsProgress(s)[2]!.status).toBe("skipped");
    const back = cvReopenTopic(s, "experiencia");
    expect(nextCvTopic(back)!.kind).toBe("organization");
    expect(back.workDone).toBe(false);
  });

  it("reabrir un tema que no está salteado no cambia nada", () => {
    const s = guided({ target: "Puesto A" });
    expect(cvReopenTopic(s, "puesto")).toEqual(s);
  });
});

describe("las respuestas del flujo guiado las resuelve el código", () => {
  it("«no», «no tengo» o «saltear» no guardan nada", () => {
    for (const m of ["no", "No tengo", "  paso  ", "no sé", "ninguna"]) {
      expect(cvLocalAnswer(m), m).toEqual({ answer: null });
    }
  });

  it("una respuesta normal se guarda con las palabras de la persona, limpia", () => {
    expect(
      cvLocalAnswer("  trabajo hace tres años en contabilidad, sobre todo impuestos "),
    ).toEqual({
      answer: "Trabajo hace tres años en contabilidad, sobre todo impuestos",
    });
  });

  it("links, emails y datos sensibles no entran", () => {
    expect(cvLocalAnswer("Escribime a persona@example.com")).toEqual({ answer: "Escribime a" });
    expect(cvLocalAnswer("Tengo 34 años y soy casada")).toEqual({ answer: null });
  });

  it("la respuesta de un tema del resumen queda en el estado y borra el borrador viejo", () => {
    let s = guided({ target: "Puesto A" });
    s = { ...s, summary: { ...s.summary, text: "Borrador viejo." } };
    s = answer(s, cvLocalAnswer("Cinco años en logística"));
    expect(s.summary.experience).toBe("Cinco años en logística");
    expect(s.summary.text).toBeNull();
  });

  it("el estado guiado viaja por JSON y el servidor lo acepta (inicial, con respuestas y con blandas)", () => {
    let s = guided({ target: "Puesto A" });
    const viaja = (x: CvChatState) => parseCvChatState(JSON.parse(JSON.stringify(x)));
    expect(viaja(s)).toEqual(s);
    s = answer(s, say("Tres años en administración"));
    s = answer(s, say("no"));
    expect(viaja(s)).toEqual(s);
    const conBlandas: CvChatState = {
      ...s,
      softAnswers: { lead: "Coordiné un equipo" },
      softDecided: { Liderazgo: "used" },
      softSkills: ["Liderazgo"],
      skipped: ["summary_goal"],
    };
    expect(viaja(conBlandas)).toEqual(conBlandas);
  });

  it("el estado que sale de `start` con una semilla real (historial, habilidades, idiomas y links) lo acepta el servidor", () => {
    const s = initialCvChatState({
      guided: true,
      target: "Analista de datos",
      history: [
        {
          kind: "educacion",
          organization: "Institución A",
          title: "Título A",
          startMonth: "2015-03",
          endMonth: "2019-12",
          bullets: [],
        },
        {
          kind: "proyecto",
          organization: "Proyecto A",
          title: "Proyecto",
          startMonth: null,
          endMonth: null,
          bullets: ["Algo"],
          link: "https://example.com/a",
        },
      ],
      skills: ["Excel", "SQL"],
      languages: [{ name: "Inglés", level: null }],
      links: { linkedin: "https://example.com/in/a" },
    });
    const viaja = parseCvChatState(JSON.parse(JSON.stringify(s)));
    expect(viaja).toEqual(s);
    // y después de contestar un tema del resumen y uno de siempre
    const t = answer(s, say("no"));
    expect(parseCvChatState(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it("links del origen del CV con claves de más (`other`, R33-07): la semilla las filtra y el estado parsea", () => {
    // Lo que devuelve `loadCvSource`: los tres links, `other` con etiqueta y url, y hasta valores vacíos o null
    const delOrigen = {
      linkedin: "https://example.com/in/a",
      github: "",
      portfolio: null,
      other: { label: "Blog", url: "https://example.com/blog" },
      telefono: "no corresponde",
    };
    const links = pickCvChatLinks(delOrigen);
    expect(links).toEqual({ linkedin: "https://example.com/in/a" });
    const s = initialCvChatState({ guided: true, target: "Puesto A", links });
    expect(parseCvChatState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    // sin el filtro, el esquema estricto rechaza el estado: es lo que rompía cada turno con `bad_request`
    const sinFiltro = initialCvChatState({
      guided: true,
      target: "Puesto A",
      links: delOrigen as never,
    });
    expect(parseCvChatState(JSON.parse(JSON.stringify(sinFiltro)))).toBeNull();
    expect(pickCvChatLinks(undefined)).toEqual({});
    expect(pickCvChatLinks("texto")).toEqual({});
  });

  it("el estado viejo del navegador (sin los campos nuevos) se acepta con valores por defecto", () => {
    const old = { ...initialCvChatState({ target: "Puesto A" }) } as Record<string, unknown>;
    for (const k of ["guided", "skipped", "summary", "softAnswers", "softDecided", "softSkills"]) {
      delete old[k];
    }
    const parsed = parseCvChatState(old);
    expect(parsed).not.toBeNull();
    expect(parsed!.guided).toBe(false);
    expect(parsed!.summary).toEqual({ experience: null, goal: null, strengths: null, text: null });
    expect(parsed!.softSkills).toEqual([]);
  });
});

describe("resumen profesional: borrador de 2 o 3 frases sin inventar", () => {
  const withSummary = (s: CvChatState, p: Partial<CvChatState["summary"]>): CvChatState => ({
    ...s,
    summary: { ...s.summary, ...p },
  });

  it("arma el borrador con las palabras de la persona y la frase del puesto buscado, en un solo bloque", () => {
    const s = withSummary(guided({ target: "Analista contable" }), {
      experience: "Tres años en administración y cobranzas",
      goal: "Quiero sumarme a un equipo chico",
      strengths: "Ordeno información y detecto errores",
    });
    const d = cvSummaryDraft(s)!;
    expect(d).toContain("Tres años en administración y cobranzas.");
    expect(d).toContain("Busco un puesto de Analista contable.");
    expect(d).toContain("Quiero sumarme a un equipo chico.");
    expect(d).toContain("Ordeno información y detecto errores");
    // sin «Objetivo» aparte
    expect(d.toLowerCase()).not.toContain("objetivo");
    // entre 2 y 3 bloques de frases (separados por salto de línea no hay: un solo párrafo)
    expect(d).not.toContain("\n");
    expect(d.length).toBeLessThanOrEqual(600);
  });

  it("sin respuestas del resumen no hay borrador (lo vacío queda vacío)", () => {
    expect(cvSummaryDraft(guided({ target: "Analista contable" }))).toBeNull();
    expect(cvSummaryDraft(guided())).toBeNull();
  });

  it("con una sola respuesta alcanza, sin sumar nada más", () => {
    const d = cvSummaryDraft(withSummary(guided(), { experience: "Cinco años en logística" }));
    expect(d).toBe("Cinco años en logística.");
  });

  it("nunca trae una cifra o un dato que no esté en las respuestas", () => {
    const s = withSummary(guided({ target: "Analista contable" }), {
      experience: "Tres años en administración",
      strengths: "Ordeno información",
    });
    const d = cvSummaryDraft(s)!;
    expect(cvSummaryCheck(d, s)).toEqual({ ok: true });
    expect(d).not.toMatch(/\d/);
  });

  it("el validador rechaza cifras, nombres y tecnologías que la persona no dijo", () => {
    const s = withSummary(guided({ target: "Analista contable" }), {
      experience: "Tres años en administración",
    });
    const bad = (t: string) => cvSummaryCheck(t, s);
    expect(bad("Analista con 10 años de experiencia.")).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(["number_not_in_answers"]),
    });
    expect(bad("Analista con diez años de experiencia.")).toMatchObject({ ok: false });
    expect(bad("Trabajé en Empresa Ficticia como analista.")).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(["name_not_in_answers"]),
    });
    expect(bad("Manejo PostgreSQL y SQL.")).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(["technology_not_in_answers"]),
    });
    expect(bad("Más de 3 años liderando equipos.")).toMatchObject({ ok: false });
    expect(bad("Tres años en administración.")).toEqual({ ok: true });
  });

  it("un texto de IA que no pasa el validador se reemplaza por el borrador de las respuestas", () => {
    const s = withSummary(guided({ target: "Analista contable" }), {
      experience: "Tres años en administración",
    });
    const fromAnswers = cvSummaryDraft(s)!;
    expect(cvSummaryChoose("Analista con 10 años de experiencia en Empresa Ficticia.", s)).toEqual({
      text: fromAnswers,
      origin: "answers",
    });
    expect(
      cvSummaryChoose("Tres años en administración, buscando un puesto de analista contable.", s),
    ).toMatchObject({
      origin: "model",
    });
    expect(cvSummaryChoose(null, s)).toEqual({ text: fromAnswers, origin: "answers" });
  });

  it("el resumen final es el de la persona; si lo vació, queda vacío; sin revisión, el validado", () => {
    const base = withSummary(guided({ target: "Analista contable" }), {
      experience: "Tres años en administración",
    });
    const editado = withSummary(base, { text: "Contadora con experiencia propia." });
    expect(cvSummaryFinal(editado, "Analista con 10 años.")).toBe(
      "Contadora con experiencia propia.",
    );
    expect(
      cvSummaryFinal(withSummary(base, { text: "   " }), "Tres años en administración."),
    ).toBeNull();
    // sin pasar por la revisión: el de la IA si pasa el validador, si no el de las respuestas
    expect(cvSummaryFinal(base, "Analista con 10 años.")).toBe(cvSummaryDraft(base));
    expect(cvSummaryFinal(base, "Tres años en administración, puesto de analista contable.")).toBe(
      "Tres años en administración, puesto de analista contable.",
    );
  });

  it("sin nada que decir, ni IA ni respuestas: queda vacío", () => {
    expect(cvSummaryChoose("Profesional con 15 años de trayectoria.", guided())).toEqual({
      text: null,
      origin: "none",
    });
  });
});

describe("habilidades blandas por situaciones", () => {
  const withSoft = (
    answers: CvChatState["softAnswers"],
    org: string | null = "Empresa A",
  ): CvChatState => {
    let s = guided({ target: "Puesto A" });
    if (org) {
      s = {
        ...s,
        works: [
          {
            organization: org,
            title: "Cargo A",
            startMonth: null,
            endMonth: null,
            isCurrent: false,
            duties: [],
            achievement: null,
          },
        ],
      };
    }
    return { ...s, softAnswers: answers };
  };

  it("sin respuestas a las situaciones no se propone nada", () => {
    expect(cvSoftProposals(withSoft({}))).toEqual([]);
  });

  it("cada habilidad dice de dónde salió y sale de lo que la persona contó", () => {
    const p = cvSoftProposals(withSoft({ lead: "Coordiné a cuatro personas en el local" }));
    expect(p.map((x) => x.skill)).toEqual(["Liderazgo", "Comunicación"]);
    for (const x of p) {
      expect(x.situation).toBe("lead");
      expect(x.from).toBe("Empresa A");
      expect(x.bullet).toBe("Coordiné a cuatro personas en el local");
    }
  });

  it("sin trabajo cargado, de dónde salió es «lo que contaste» (sin empresa)", () => {
    const p = cvSoftProposals(withSoft({ problem: "Resolví un error de facturación" }, null));
    expect(p).toHaveLength(1);
    expect(p[0]!.from).toBeNull();
  });

  it("como máximo 4, aunque haya más candidatas", () => {
    const all = withSoft({
      lead: "Coordiné un equipo",
      problem: "Resolví un error",
      clients: "Atendí clientes",
      organize: "Armé un sistema de archivo",
    });
    const p = cvSoftProposals(all);
    expect(CV_SOFT_MAX).toBe(4);
    expect(p).toHaveLength(4);
    expect(p.map((x) => x.skill)).toEqual([
      "Liderazgo",
      "Comunicación",
      "Resolución de problemas",
      "Atención al cliente",
    ]);
  });

  it("«No, gracias» la saca y deja lugar a otra; no vuelve a aparecer", () => {
    let s = withSoft({
      lead: "Coordiné un equipo",
      problem: "Resolví un error",
      clients: "Atendí clientes",
      organize: "Armé un sistema de archivo",
    });
    s = cvSoftDecide(s, "Liderazgo", "declined");
    const p = cvSoftProposals(s);
    expect(p.map((x) => x.skill)).not.toContain("Liderazgo");
    expect(p).toHaveLength(4);
    expect(p.map((x) => x.skill)).toContain("Trabajo en equipo");
    expect(s.softSkills).toEqual([]);
  });

  it("«Usarla» la suma a las habilidades blandas y a las del CV, y suma la viñeta al trabajo, una sola vez", () => {
    let s = withSoft({ lead: "Coordiné a cuatro personas" });
    s = cvSoftDecide(s, "Liderazgo", "used");
    s = cvSoftDecide(s, "Comunicación", "used");
    expect(s.softSkills).toEqual(["Liderazgo", "Comunicación"]);
    expect(s.works[0]!.duties).toEqual(["Coordiné a cuatro personas"]);
    expect(cvSoftProposals(s)).toEqual([]);
    s = { ...s, skills: ["Excel"] };
    expect(cvAllSkills(s)).toEqual(["Excel", "Liderazgo", "Comunicación"]);
  });

  it("lo usado cuenta para el tope: con 4 usadas no se propone otra", () => {
    let s = withSoft({
      lead: "Coordiné un equipo",
      problem: "Resolví un error",
      clients: "Atendí clientes",
      organize: "Armé un sistema de archivo",
    });
    for (const k of [
      "Liderazgo",
      "Comunicación",
      "Resolución de problemas",
      "Atención al cliente",
    ]) {
      s = cvSoftDecide(s, k, "used");
    }
    expect(s.softSkills).toHaveLength(4);
    expect(cvSoftProposals(s)).toEqual([]);
    // un quinto «Usarla» forzado no entra
    expect(cvSoftDecide(s, "Trabajo en equipo", "used").softSkills).toHaveLength(4);
  });

  it("decidir una habilidad que no se propuso no hace nada", () => {
    const s = withSoft({ lead: "Coordiné un equipo" });
    expect(cvSoftDecide(s, "Creatividad", "used")).toEqual(s);
  });

  it("el estado de la viñeta se sabe antes del clic: suma, ya está, sin lugar o sin trabajo", () => {
    const base = withSoft({ lead: "Coordiné un equipo" });
    const p = (s: CvChatState) => cvSoftProposals(s)[0]!;
    expect(cvSoftBulletStatus(base, p(base))).toBe("suma");
    const yaEsta = { ...base, works: [{ ...base.works[0]!, duties: ["coordiné un equipo"] }] };
    expect(cvSoftBulletStatus(yaEsta, p(yaEsta))).toBe("ya_esta");
    const lleno = {
      ...base,
      works: [{ ...base.works[0]!, duties: ["Uno", "Dos", "Tres", "Cuatro"] }],
    };
    expect(cvSoftBulletStatus(lleno, p(lleno))).toBe("sin_lugar");
    const sinTrabajo = withSoft({ lead: "Coordiné un equipo" }, null);
    expect(cvSoftBulletStatus(sinTrabajo, p(sinTrabajo))).toBe("sin_trabajo");
    // en los cuatro casos la habilidad entra igual: lo que cambia es la viñeta, y la pantalla lo avisa
    for (const s of [base, yaEsta, lleno, sinTrabajo]) {
      expect(cvSoftDecide(s, "Liderazgo", "used").softSkills).toEqual(["Liderazgo"]);
    }
    expect(CV_WORK_DUTIES_MAX).toBe(4);
  });

  it("la viñeta no se suma si el trabajo ya tiene 4 tareas", () => {
    let s = withSoft({ lead: "Coordiné un equipo" });
    s = {
      ...s,
      works: [{ ...s.works[0]!, duties: ["Uno", "Dos", "Tres", "Cuatro"] }],
    };
    s = cvSoftDecide(s, "Liderazgo", "used");
    expect(s.softSkills).toEqual(["Liderazgo"]);
    expect(s.works[0]!.duties).toHaveLength(4);
  });
});
