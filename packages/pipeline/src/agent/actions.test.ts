import { describe, expect, it } from "vitest";
import type { JobEvent, JobStatus, ManualJobEvent } from "../status";
import {
  actionLogMeta,
  actionModelText,
  actionSourcesFrom,
  buildActionProposal,
  buildNewJobAction,
  buildStatusChangeAction,
  eventEvidence,
  type StatusChangeContext,
} from "./actions";
import { CV_OMITTED_MARKER } from "./cv-detect";
import {
  activeToolsFor,
  AGENT_ACTION_TOOLS,
  isActionTool,
  isAgentTool,
  isProposalTool,
} from "./tools";

const JOB_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "99999999-2222-4333-8444-555555555555";

const evaluada = (lastUserMessage: string): StatusChangeContext => ({
  job: {
    id: JOB_ID,
    title: "Desarrolladora Backend",
    company: "Empresa Ficticia",
    status: "evaluada",
    events: ["apply", "discard", "close"],
  },
  lastUserMessage,
  statusLabels: { evaluada: "Evaluada", aplicada: "Aplicada", descartada: "Descartada" },
});

const input = (event: string, quote: string, jobId = JOB_ID) => ({
  job_id: jobId,
  event,
  source: { from: "message", quote },
});

describe("catálogo de acciones", () => {
  it("las dos tools de acción son tools del asistente y cuentan como propuesta", () => {
    for (const name of AGENT_ACTION_TOOLS) {
      expect(isActionTool(name)).toBe(true);
      expect(isAgentTool(name)).toBe(true);
      expect(isProposalTool(name)).toBe(true);
    }
    expect(isProposalTool("propose_profile")).toBe(true);
    expect(isProposalTool("get_job")).toBe(false);
    expect(isActionTool("propose_profile")).toBe(false);
  });

  it("activeToolsFor las ofrece junto con las propuestas y las saca después de una", () => {
    const first = activeToolsFor({ turn: 0, step: 0, proposalsThisTurn: 0, screen: null });
    expect(first).toEqual(expect.arrayContaining([...AGENT_ACTION_TOOLS]));
    const after = activeToolsFor({ turn: 0, step: 1, proposalsThisTurn: 1, screen: null });
    for (const name of AGENT_ACTION_TOOLS) expect(after).not.toContain(name);
  });
});

describe("eventEvidence: hecho consumado, en primera persona, sin negar ni preguntar", () => {
  // [evento, mensaje de la persona, cita del modelo, ¿respalda?]
  const table: [ManualJobEvent, string, string, boolean][] = [
    // apply
    ["apply", "Ya me postulé a esta oferta ayer.", "me postulé a esta", true],
    ["apply", "Hola! Postulé el lunes, ¿qué sigue?", "Postulé el lunes", true],
    ["apply", "Les mandé el CV por mail.", "mandé el CV por mail", true],
    ["apply", "Apliqué hoy temprano", "Apliqué hoy temprano", true],
    ["apply", "Perdón, sí: ya me postulé a esta", "ya me postulé a esta", true],
    ["apply", "Todavía no me postulé a esta", "no me postulé a esta", false],
    ["apply", "No me postulé todavía", "No me postulé todavía", false],
    ["apply", "¿Me postulé a esta oferta?", "Me postulé a esta oferta", false],
    ["apply", "Tiene 300 postulantes, ¿vale la pena?", "300 postulantes", false],
    ["apply", "Quiero postularme a esta oferta", "postularme a esta oferta", false],
    ["apply", "Si me postulo hoy, ¿llego?", "me postulo hoy", false],
    ["apply", "Voy a mandar el CV mañana", "mandar el CV mañana", false],
    ["apply", "Capaz me postulé a esta, no me acuerdo", "me postulé a esta", false],
    // interview
    ["interview", "Tengo entrevista el martes.", "Tengo entrevista el martes", true],
    ["interview", "Me citaron para la segunda instancia", "Me citaron para la", true],
    ["interview", "El entrevistador era amable", "El entrevistador era", false],
    ["interview", "No tuve entrevista todavía", "No tuve entrevista", false],
    // offer
    ["offer", "Me hicieron una oferta formal", "Me hicieron una oferta", true],
    ["offer", "Me ofrecieron el puesto!", "Me ofrecieron el puesto", true],
    ["offer", "Me postulé a esta oferta", "a esta oferta", false],
    ["offer", "Me ofrecieron un café en la entrevista", "Me ofrecieron un café", false],
    // reject
    ["reject", "No quedé, me avisaron hoy.", "No quedé, me avisaron", true],
    ["reject", "Me rechazaron por mail", "Me rechazaron por mail", true],
    ["reject", "¿Me rechazaron?", "Me rechazaron", false],
    // auto_reject
    ["auto_reject", "Me llegó un rechazo automático", "un rechazo automático", true],
    ["auto_reject", "Es automático el proceso", "automático el proceso", false],
    // discard
    ["discard", "No me interesa esta oferta.", "No me interesa esta oferta", true],
    ["discard", "Descartala, por favor", "Descartala, por favor", true],
    ["discard", "Me interesa esta oferta", "Me interesa esta oferta", false],
    // close
    ["close", "La bajaron del portal ayer", "La bajaron del portal", true],
    ["close", "Cerraron la búsqueda.", "Cerraron la búsqueda", true],
    ["close", "¿La bajaron del portal?", "La bajaron del portal", false],
  ];
  for (const [event, message, quote, expected] of table) {
    it(`${event} · «${message}» → ${expected}`, () => {
      expect(eventEvidence(event, quote, message) !== null).toBe(expected);
    });
  }

  it("devuelve la oración completa del mensaje", () => {
    expect(
      eventEvidence("apply", "me postulé a esta", "Buenas. Ya me postulé a esta, gracias!"),
    ).toEqual({
      sentence: "Ya me postulé a esta, gracias!",
    });
  });

  it("la cita tiene que estar en el mensaje y tener 2 palabras", () => {
    expect(eventEvidence("apply", "me postulé", "Ayer me anoté")).toBeNull();
    expect(eventEvidence("apply", "postulé", "Postulé ayer")).toBeNull();
  });
});

describe("buildStatusChangeAction", () => {
  it("arma la tarjeta con la oferta de la base y la oración de la persona", () => {
    const r = buildStatusChangeAction(
      input("apply", "ya me postulé a esta"),
      evaluada("Hola, ya me postulé a esta. ¿Qué sigue?"),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      kind: "status_change",
      jobId: JOB_ID,
      jobLabel: "Desarrolladora Backend · Empresa Ficticia",
      event: "apply",
      fromStatus: "evaluada",
      fromLabel: "Evaluada",
      toLabel: "Aplicada",
      source: { from: "message", quote: "ya me postulé a esta" },
      sentence: "Hola, ya me postulé a esta.",
    });
  });

  it("solo cuenta el mensaje de este turno (no uno de turnos anteriores)", () => {
    const r = buildStatusChangeAction(
      input("apply", "ya me postulé a esta"),
      evaluada("contame más de la empresa"),
    );
    expect(r).toEqual({
      ok: false,
      error: { code: "sin_fundamento", dropped: [{ field: "event", reason: "sin_fundamento" }] },
    });
  });

  it("una cita del perfil no respalda un cambio de estado", () => {
    const r = buildStatusChangeAction(
      { job_id: JOB_ID, event: "apply", source: { from: "profile", quote: "ya me postulé" } },
      evaluada("ya me postulé"),
    );
    expect(r.ok).toBe(false);
  });

  it("un evento que no vale desde el estado actual es inválido", () => {
    const r = buildStatusChangeAction(
      input("interview", "Tengo entrevista el lunes"),
      evaluada("Tengo entrevista el lunes"),
    );
    expect(r).toEqual({
      ok: false,
      error: { code: "invalido", dropped: [{ field: "event", reason: "invalido" }] },
    });
  });

  it("si la app manda un evento que la máquina de estados no permite, no lanza: inválido", () => {
    const ctx = evaluada("No me interesa esta oferta");
    const r = buildStatusChangeAction(input("discard", "No me interesa esta oferta"), {
      ...ctx,
      job: { ...ctx.job!, status: "aplicada" as JobStatus, events: ["discard"] as JobEvent[] },
    });
    expect(r.ok).toBe(false);
  });

  it("una oferta que no existe para la persona (o con otro id) no arma nada", () => {
    expect(
      buildStatusChangeAction(input("apply", "ya me postulé a esta"), {
        ...evaluada("ya me postulé a esta"),
        job: null,
      }),
    ).toEqual({ ok: false, error: { code: "oferta_inexistente", dropped: [] } });
    const r = buildStatusChangeAction(
      input("apply", "ya me postulé a esta", OTHER_ID),
      evaluada("ya me postulé a esta"),
    );
    expect(r.ok).toBe(false);
  });

  it("eventos que no son de la persona o entrada rara → entrada_invalida", () => {
    for (const bad of [
      input("evaluated", "ya me postulé a esta"),
      { ...input("apply", "ya me postulé a esta"), extra: 1 },
      input("apply", "ya me postulé a esta", "no-es-uuid"),
    ]) {
      const r = buildStatusChangeAction(bad, evaluada("ya me postulé a esta"));
      expect(r).toEqual({ ok: false, error: { code: "entrada_invalida", dropped: [] } });
    }
  });
});

describe("buildNewJobAction", () => {
  const msg =
    "Agregá la oferta Ingeniera de Datos de Compañía Inventada, remoto desde Montevideo: https://empleos.example.com/ofertas/123";
  const base = {
    title: "Ingeniera de Datos",
    company: "Compañía Inventada",
    source: { from: "message", quote: "Agregá la oferta Ingeniera de Datos" },
  };

  it("prellena solo lo que la persona escribió literal", () => {
    const r = buildNewJobAction(
      {
        ...base,
        url: "https://empleos.example.com/ofertas/123",
        location: "Montevideo",
        modality: "remoto",
      },
      { userTexts: [msg] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      kind: "new_job",
      fields: {
        title: "Ingeniera de Datos",
        company: "Compañía Inventada",
        url: "https://empleos.example.com/ofertas/123",
        location: "Montevideo",
        modality: "remoto",
      },
      source: base.source,
      dropped: [],
    });
  });

  it("descarta link, ubicación y modalidad que no están en el mensaje", () => {
    const r = buildNewJobAction(
      { ...base, url: "https://otro.example.com/x", location: "Lima", modality: "hibrido" },
      { userTexts: [msg] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.kind !== "new_job") return;
    expect(r.value.fields).toEqual({
      title: "Ingeniera de Datos",
      company: "Compañía Inventada",
      url: null,
      location: null,
      modality: "desconocida",
    });
    expect(r.value.dropped).toEqual([
      { field: "url", reason: "sin_fundamento" },
      { field: "location", reason: "sin_fundamento" },
      { field: "modality", reason: "sin_fundamento" },
    ]);
  });

  it("el link tiene que ser exacto: ni un dominio parecido ni otras mayúsculas en el path", () => {
    for (const url of [
      "https://empleos.exámple.com/ofertas/123",
      "https://empleos.example.com/Ofertas/123",
      "https://empleos.example.com/ofertas/1234",
    ]) {
      const r = buildNewJobAction({ ...base, url }, { userTexts: [msg] });
      expect(r.ok && r.value.kind === "new_job" && r.value.fields.url, url).toBe(null);
    }
  });

  it("un link interno es inválido aunque esté en el mensaje", () => {
    const text = "Agregá Analista QA de Empresa Uno: http://127.0.0.1/admin";
    const r = buildNewJobAction(
      {
        title: "Analista QA",
        company: "Empresa Uno",
        url: "http://127.0.0.1/admin",
        source: { from: "message", quote: "Agregá Analista QA de Empresa Uno" },
      },
      { userTexts: [text] },
    );
    expect(r.ok && r.value.kind === "new_job" && r.value.dropped).toEqual([
      { field: "url", reason: "invalido" },
    ]);
  });

  it("título y empresa con bordes de palabra: «Ana» no sale de «Analista»", () => {
    const r = buildNewJobAction(
      {
        title: "Ana",
        company: "Empresa Uno",
        source: { from: "message", quote: "Agregá Analista QA de Empresa Uno" },
      },
      { userTexts: ["Agregá Analista QA de Empresa Uno"] },
    );
    expect(r).toEqual({
      ok: false,
      error: { code: "sin_fundamento", dropped: [{ field: "title", reason: "sin_fundamento" }] },
    });
  });

  it("sin título o empresa literales no hay tarjeta", () => {
    const r = buildNewJobAction({ ...base, title: "Directora de Datos" }, { userTexts: [msg] });
    expect(r.ok).toBe(false);
  });

  it("modalidad negada o de otro mensaje no se prellena", () => {
    const negated =
      "Agregá la oferta Ingeniera de Datos de Compañía Inventada, remoto no, es presencial";
    const r1 = buildNewJobAction({ ...base, modality: "remoto" }, { userTexts: [negated] });
    expect(r1.ok && r1.value.kind === "new_job" && r1.value.fields.modality).toBe("desconocida");
    const r2 = buildNewJobAction(
      { ...base, modality: "remoto" },
      {
        userTexts: [
          "Agregá la oferta Ingeniera de Datos de Compañía Inventada",
          "Otra cosa: la de ayer era remoto",
        ],
      },
    );
    expect(r2.ok && r2.value.kind === "new_job" && r2.value.fields.modality).toBe("desconocida");
  });

  it("caracteres invisibles o de control en un campo lo invalidan", () => {
    for (const title of ["Analista‮QA", "Analista QA", "Analista\u0085QA"]) {
      const r = buildNewJobAction(
        {
          title,
          company: "Empresa Uno",
          source: { from: "message", quote: "Agregá Analista QA de Empresa Uno" },
        },
        { userTexts: ["Agregá Analista QA de Empresa Uno"] },
      );
      expect(r.ok, JSON.stringify(title)).toBe(false);
    }
  });

  it("valores con pinta de contacto: título o empresa → inválido; ubicación → se descarta", () => {
    const text =
      "Agregá la oferta Ingeniera de Datos de rrhh@example.com, ubicación +1 555 0100 1234";
    const r1 = buildNewJobAction({ ...base, company: "rrhh@example.com" }, { userTexts: [text] });
    expect(r1).toEqual({
      ok: false,
      error: { code: "invalido", dropped: [{ field: "company", reason: "invalido" }] },
    });
    const r2 = buildNewJobAction(
      { ...base, location: "+1 555 0100 1234" },
      { userTexts: [msg, text] },
    );
    expect(r2.ok && r2.value.kind === "new_job" && r2.value.dropped).toEqual([
      { field: "location", reason: "invalido" },
    ]);
  });

  it("título y empresa recortados y con largo mínimo", () => {
    const r = buildNewJobAction({ ...base, company: " X " }, { userTexts: [msg] });
    expect(r).toEqual({ ok: false, error: { code: "entrada_invalida", dropped: [] } });
  });
});

describe("fuentes, log y texto para el modelo", () => {
  it("las fuentes de acciones son los mensajes de la persona sin CVs (ni el marcador ni el crudo)", () => {
    const cv = [
      "Persona Inventada",
      "persona.inventada@example.com · +1 555 0100",
      "Experiencia laboral",
      "Desarrolladora en Empresa Ficticia (2019 - 2023)",
      "Educación",
      "Licenciatura inventada (2014 - 2018)",
      "Habilidades",
      "TypeScript, React, Node.js",
    ].join("\n");
    expect(
      actionSourcesFrom([
        { role: "user", text: "Agregá la oferta X de Y" },
        { role: "assistant", text: "Agregá la oferta Z de W" },
        { role: "user", text: CV_OMITTED_MARKER },
        { role: "assistant", text: "ok" },
        { role: "user", text: cv },
      ]),
    ).toEqual({ userTexts: ["Agregá la oferta X de Y"] });
  });

  it("buildActionProposal despacha y falla cerrado sin contexto", () => {
    expect(buildActionProposal("propose_status_change", {}, {})).toEqual({
      ok: false,
      error: { code: "sin_contexto", dropped: [] },
    });
    expect(buildActionProposal("propose_new_job", {}, {})).toEqual({
      ok: false,
      error: { code: "sin_contexto", dropped: [] },
    });
  });

  it("el log de una falla lleva el código y los descartes proyectados", () => {
    const dropped = [{ field: "title", reason: "sin_fundamento" as const, extra: "Ana" }];
    expect(actionLogMeta({ code: "sin_fundamento", dropped })).toEqual({
      code: "sin_fundamento",
      fields: [],
      dropped: [{ field: "title", reason: "sin_fundamento" }],
    });
    expect(actionModelText({ ok: false, code: "sin_fundamento", dropped })).not.toContain("Ana");
  });

  it("ni el log ni el modelo ven títulos, empresas, links, citas ni la oración", () => {
    const r = buildNewJobAction(
      {
        title: "Ingeniera de Datos",
        company: "Compañía Inventada",
        url: "https://empleos.example.com/ofertas/123",
        source: { from: "message", quote: "Agregá la oferta Ingeniera de Datos" },
      },
      {
        userTexts: [
          "Agregá la oferta Ingeniera de Datos de Compañía Inventada https://empleos.example.com/ofertas/123",
        ],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texts = [
      JSON.stringify(actionLogMeta(r.value)),
      actionModelText({ ok: true, action: r.value }),
    ];
    for (const t of texts) expect(t).not.toMatch(/Ingeniera|Inventada|example\.com|Agregá/);
    const status = buildStatusChangeAction(
      input("apply", "ya me postulé a esta"),
      evaluada("ya me postulé a esta"),
    );
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const st = [
      JSON.stringify(actionLogMeta(status.value)),
      actionModelText({ ok: true, action: status.value }),
    ];
    for (const t of st) expect(t).not.toMatch(/Backend|Ficticia|postulé/);
    expect(actionModelText({ ok: false, code: "sin_fundamento", dropped: [] })).toContain(
      "tarjeta_lista",
    );
    expect(actionModelText("basura")).toContain("tool_fallo");
  });
});
