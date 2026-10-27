import { describe, expect, it } from "vitest";
import {
  actionLogMeta,
  actionModelText,
  actionSourcesFrom,
  buildActionProposal,
  buildNewJobAction,
  buildStatusChangeAction,
  type StatusChangeContext,
} from "./actions";
import type { JobEvent, JobStatus } from "../status";
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

const sources = (...userMessages: string[]) => ({ userMessages, profileTexts: [] });

const evaluada = (msgs: string[]): StatusChangeContext => ({
  job: {
    id: JOB_ID,
    title: "Desarrolladora Backend",
    company: "Empresa Ficticia",
    status: "evaluada",
    events: ["apply", "discard", "close"],
  },
  sources: sources(...msgs),
  statusLabels: { evaluada: "Evaluada", aplicada: "Aplicada", descartada: "Descartada" },
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

describe("buildStatusChangeAction", () => {
  const input = (event: string, quote: string, jobId = JOB_ID) => ({
    job_id: jobId,
    event,
    source: { from: "message", quote },
  });

  it("arma la tarjeta con la oferta de la base y la cita de la persona", () => {
    const r = buildStatusChangeAction(
      input("apply", "ya me postulé a esta"),
      evaluada(["Hola, ya me postulé a esta, ¿qué sigue?"]),
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
    });
  });

  it("la cita tiene que nombrar el evento (una cita cualquiera no alcanza)", () => {
    const r = buildStatusChangeAction(
      input("apply", "contame de esta oferta"),
      evaluada(["contame de esta oferta por favor"]),
    );
    expect(r).toEqual({
      ok: false,
      error: { code: "sin_fundamento", dropped: [{ field: "event", reason: "sin_fundamento" }] },
    });
  });

  it("«esta oferta» no fundamenta el evento offer", () => {
    const r = buildStatusChangeAction(
      input("offer", "me postulé a esta oferta"),
      evaluada(["me postulé a esta oferta ayer"]),
    );
    expect(r.ok).toBe(false);
  });

  it("la cita tiene que estar en un mensaje de la persona, no en el perfil", () => {
    const ctx = { ...evaluada([]), sources: { userMessages: [], profileTexts: ["ya me postulé"] } };
    const r = buildStatusChangeAction(
      { job_id: JOB_ID, event: "apply", source: { from: "profile", quote: "ya me postulé" } },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("un evento que no vale desde el estado actual es inválido", () => {
    const r = buildStatusChangeAction(
      input("interview", "me llamaron para una entrevista"),
      evaluada(["me llamaron para una entrevista el lunes"]),
    );
    expect(r).toEqual({
      ok: false,
      error: { code: "invalido", dropped: [{ field: "event", reason: "invalido" }] },
    });
  });

  it("una oferta que no existe para la persona (o con otro id) no arma nada", () => {
    expect(
      buildStatusChangeAction(input("apply", "ya me postulé a esta"), {
        ...evaluada(["ya me postulé a esta"]),
        job: null,
      }),
    ).toEqual({
      ok: false,
      error: { code: "oferta_inexistente", dropped: [] },
    });
    const r = buildStatusChangeAction(
      input("apply", "ya me postulé a esta", OTHER_ID),
      evaluada(["ya me postulé a esta"]),
    );
    expect(r.ok).toBe(false);
  });

  it("eventos que no son de la persona o entrada rara → entrada_invalida", () => {
    for (const bad of [
      input("evaluated", "ya me postulé a esta"),
      { ...input("apply", "ya me postulé a esta"), extra: 1 },
      input("apply", "ya me postulé a esta", "no-es-uuid"),
    ]) {
      const r = buildStatusChangeAction(bad, evaluada(["ya me postulé a esta"]));
      expect(r).toEqual({ ok: false, error: { code: "entrada_invalida", dropped: [] } });
    }
  });

  it("cada evento tiene sus palabras", () => {
    const cases: [string, string, JobStatus, string[]][] = [
      ["discard", "esta no me interesa", "evaluada", ["apply", "discard", "close"]],
      ["close", "la bajaron del portal", "evaluada", ["apply", "discard", "close"]],
      ["interview", "tengo entrevista el martes", "aplicada", ["interview", "reject", "close"]],
      ["reject", "me rechazaron por mail", "aplicada", ["interview", "reject", "auto_reject"]],
      ["offer", "me hicieron una oferta", "entrevista", ["offer", "reject", "close"]],
    ];
    for (const [event, quote, status, events] of cases) {
      const ctx = evaluada([`Te cuento: ${quote}.`]);
      const r = buildStatusChangeAction(input(event, quote), {
        ...ctx,
        job: { ...ctx.job!, status, events: events as JobEvent[] },
      });
      expect(r.ok, `${event}: ${quote}`).toBe(true);
    }
  });

  it("si la app manda un evento que la máquina de estados no permite, no lanza: inválido", () => {
    const ctx = evaluada(["esta no me interesa"]);
    const r = buildStatusChangeAction(input("discard", "esta no me interesa"), {
      ...ctx,
      job: { ...ctx.job!, status: "aplicada", events: ["discard"] },
    });
    expect(r.ok).toBe(false);
  });
});

describe("buildNewJobAction", () => {
  const msg =
    "Agregá la oferta Ingeniera de Datos de Compañía Inventada, remoto desde Montevideo: https://empleos.example.com/ofertas/123";

  it("prellena solo lo que la persona escribió literal", () => {
    const r = buildNewJobAction(
      {
        title: "Ingeniera de Datos",
        company: "Compañía Inventada",
        url: "https://empleos.example.com/ofertas/123",
        location: "Montevideo",
        modality: "remoto",
        source: { from: "message", quote: "Agregá la oferta Ingeniera de Datos" },
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
      source: { from: "message", quote: "Agregá la oferta Ingeniera de Datos" },
      dropped: [],
    });
  });

  it("descarta link, ubicación y modalidad que no están en el mensaje", () => {
    const r = buildNewJobAction(
      {
        title: "Ingeniera de Datos",
        company: "Compañía Inventada",
        url: "https://otro.example.com/x",
        location: "Lima",
        modality: "hibrido",
        source: { from: "message", quote: "Agregá la oferta Ingeniera de Datos" },
      },
      { userTexts: [msg] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind === "new_job" && r.value.fields).toEqual({
      title: "Ingeniera de Datos",
      company: "Compañía Inventada",
      url: null,
      location: null,
      modality: "desconocida",
    });
    expect(r.value.kind === "new_job" && r.value.dropped).toEqual([
      { field: "url", reason: "sin_fundamento" },
      { field: "location", reason: "sin_fundamento" },
      { field: "modality", reason: "sin_fundamento" },
    ]);
  });

  it("sin título o empresa literales no hay tarjeta", () => {
    const r = buildNewJobAction(
      {
        title: "Directora de Datos",
        company: "Compañía Inventada",
        source: { from: "message", quote: "Agregá la oferta Ingeniera de Datos" },
      },
      { userTexts: [msg] },
    );
    expect(r).toEqual({
      ok: false,
      error: { code: "sin_fundamento", dropped: [{ field: "title", reason: "sin_fundamento" }] },
    });
  });

  it("un link interno o con credenciales es inválido aunque esté en el mensaje", () => {
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
    expect(r.ok && r.value.kind === "new_job" && r.value.fields.url).toBe(null);
    expect(r.ok && r.value.kind === "new_job" && r.value.dropped).toEqual([
      { field: "url", reason: "invalido" },
    ]);
  });

  it("caracteres invisibles en un campo lo invalidan", () => {
    const r = buildNewJobAction(
      {
        title: "Analista‮QA",
        company: "Empresa Uno",
        source: { from: "message", quote: "Agregá Analista QA de Empresa Uno" },
      },
      { userTexts: ["Agregá Analista QA de Empresa Uno"] },
    );
    expect(r.ok).toBe(false);
  });
});

describe("fuentes, log y texto para el modelo", () => {
  it("las fuentes de acciones son los mensajes de la persona sin CVs", () => {
    expect(
      actionSourcesFrom([
        { role: "user", text: "Agregá la oferta X de Y" },
        { role: "assistant", text: "Agregá la oferta Z de W" },
        { role: "user", text: CV_OMITTED_MARKER },
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

  it("ni el log ni el modelo ven títulos, empresas, links ni citas", () => {
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
    const out = { ok: true as const, action: r.value };
    const texts = [JSON.stringify(actionLogMeta(r.value)), actionModelText(out)];
    for (const t of texts) {
      expect(t).not.toMatch(/Ingeniera|Inventada|example\.com|Agregá/);
    }
    const status = buildStatusChangeAction(
      {
        job_id: JOB_ID,
        event: "apply",
        source: { from: "message", quote: "ya me postulé a esta" },
      },
      evaluada(["ya me postulé a esta"]),
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
