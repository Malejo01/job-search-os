import { describe, expect, it } from "vitest";
import { PROFILE_AGENT_TICKET_TTL_MS } from "@job-search-os/pipeline";
import { signCvTicket } from "../cv-chat/ticket";
import { signProfileAgentTicket, verifyProfileAgentTicket } from "./ticket";

const SECRET = "secreto-de-prueba";
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const FLOW = "0123456789ab";
const NOW = 1_800_000_000_000;

describe("ticket firmado del agente de perfil", () => {
  it("firma y verifica; devuelve solo el id de la charla", () => {
    const t = signProfileAgentTicket(SECRET, USER, { flowId: FLOW }, NOW);
    expect(t).not.toBeNull();
    expect(verifyProfileAgentTicket(SECRET, USER, t, NOW + 1000)).toEqual({ flowId: FLOW });
  });

  it("falla cerrado sin AUTH_SECRET", () => {
    expect(signProfileAgentTicket(undefined, USER, { flowId: FLOW }, NOW)).toBeNull();
    expect(signProfileAgentTicket("", USER, { flowId: FLOW }, NOW)).toBeNull();
    const t = signProfileAgentTicket(SECRET, USER, { flowId: FLOW }, NOW);
    expect(verifyProfileAgentTicket(undefined, USER, t, NOW)).toBeNull();
  });

  it("está atado a la persona: el de otra no vale", () => {
    const t = signProfileAgentTicket(SECRET, USER, { flowId: FLOW }, NOW);
    expect(verifyProfileAgentTicket(SECRET, OTHER, t, NOW)).toBeNull();
  });

  it("manipulado: cambiar el id, el vencimiento o la firma lo invalida", () => {
    const t = signProfileAgentTicket(SECRET, USER, { flowId: FLOW }, NOW)!;
    const [p, id, exp, mac] = t.split(".") as [string, string, string, string];
    const forgedId = [p, "ffffffffffff", exp, mac].join(".");
    const forgedExp = [p, id, String(Number(exp) + 3_600_000), mac].join(".");
    const forgedMac = [p, id, exp, `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`].join(".");
    for (const bad of [forgedId, forgedExp, forgedMac]) {
      expect(verifyProfileAgentTicket(SECRET, USER, bad, NOW)).toBeNull();
    }
  });

  it("vence a las 2 horas", () => {
    const t = signProfileAgentTicket(SECRET, USER, { flowId: FLOW }, NOW);
    expect(
      verifyProfileAgentTicket(SECRET, USER, t, NOW + PROFILE_AGENT_TICKET_TTL_MS),
    ).not.toBeNull();
    expect(
      verifyProfileAgentTicket(SECRET, USER, t, NOW + PROFILE_AGENT_TICKET_TTL_MS + 1),
    ).toBeNull();
  });

  it("firmado con otro secreto no vale", () => {
    const t = signProfileAgentTicket("otro-secreto-0123456789", USER, { flowId: FLOW }, NOW);
    expect(verifyProfileAgentTicket(SECRET, USER, t, NOW)).toBeNull();
  });

  it("un ticket del chat de CV no vale acá, ni al revés de forma que cruce flujos", () => {
    const cv = signCvTicket(SECRET, USER, { conversationId: FLOW, turns: 3 }, NOW);
    expect(verifyProfileAgentTicket(SECRET, USER, cv, NOW)).toBeNull();
    expect(verifyProfileAgentTicket(SECRET, USER, 12345, NOW)).toBeNull();
    expect(verifyProfileAgentTicket(SECRET, USER, undefined, NOW)).toBeNull();
  });
});
