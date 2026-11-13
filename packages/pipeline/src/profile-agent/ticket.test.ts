import { describe, expect, it } from "vitest";
import {
  isProfileAgentFlowId,
  parseProfileTicket,
  profileTicketExpired,
  profileTicketPayload,
  PROFILE_AGENT_TICKET_TTL_MS,
} from "./ticket";

const FLOW = "0123456789ab";
const MAC = "A".repeat(43);

describe("ticket del agente de perfil (formato)", () => {
  it("ida y vuelta del payload", () => {
    const exp = 1_800_000_000_000;
    const parsed = parseProfileTicket(`${profileTicketPayload(FLOW, exp)}.${MAC}`);
    expect(parsed).toEqual({
      flowId: FLOW,
      expiresAtMs: exp,
      payload: `pa1.${FLOW}.${exp}`,
      mac: MAC,
    });
  });

  it("rechaza formas inválidas, prefijo ajeno e ids que no son hex de 12", () => {
    const exp = 1_800_000_000_000;
    const bad: unknown[] = [
      null,
      undefined,
      42,
      "",
      `pa1.${FLOW}.${exp}`, // sin firma
      `pa2.${FLOW}.${exp}.${MAC}`,
      `${FLOW}.3.${exp}.${MAC}`, // forma del ticket del chat de CV
      `pa1.${FLOW.toUpperCase()}.${exp}.${MAC}`,
      `pa1.0123456789a.${exp}.${MAC}`,
      `pa1.${FLOW}.abc.${MAC}`,
      `pa1.${FLOW}.${exp}.corta`,
      `pa1.${FLOW}.${exp}.${MAC}.extra`,
      `pa1.${FLOW}.${exp}.${"A".repeat(300)}`,
    ];
    for (const raw of bad) expect(parseProfileTicket(raw)).toBeNull();
  });

  it("vencimiento con now inyectado; dura 2 horas", () => {
    expect(PROFILE_AGENT_TICKET_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(profileTicketExpired({ expiresAtMs: 1000 }, 1000)).toBe(false);
    expect(profileTicketExpired({ expiresAtMs: 1000 }, 1001)).toBe(true);
    expect(profileTicketExpired({ expiresAtMs: Number.NaN }, 1)).toBe(true);
  });

  it("id de charla: 12 hex en minúsculas", () => {
    expect(isProfileAgentFlowId(FLOW)).toBe(true);
    expect(isProfileAgentFlowId("xyz")).toBe(false);
    expect(isProfileAgentFlowId(12)).toBe(false);
  });
});
