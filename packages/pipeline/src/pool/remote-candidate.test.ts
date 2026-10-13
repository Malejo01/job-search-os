import { describe, expect, it } from "vitest";
import { isPoolRemoteCandidate } from "./remote-candidate";

describe("isPoolRemoteCandidate", () => {
  it("pasa si el proveedor lo marca remoto", () => {
    expect(isPoolRemoteCandidate({ workplaceType: "Remote", locationText: "Ciudad A" })).toBe(true);
    expect(isPoolRemoteCandidate({ workplaceType: "remoto" })).toBe(true);
    expect(isPoolRemoteCandidate({ isRemote: true, locationText: "Ciudad A" })).toBe(true);
  });

  it.each([
    "Remote",
    "Remoto",
    "Remote - Europe",
    "LATAM",
    "Latin America",
    "Argentina",
    "Anywhere",
    "Worldwide",
    "Home Office, Remoto (Ciudad A)",
    "Distributed",
    "Home-based",
    "Home based",
    "Work from home",
    "WFH",
    "Telecommuting",
    "Teletrabajo",
    "Global",
    "Americas",
  ])("pasa por el texto de la ubicación: %s", (locationText) => {
    expect(isPoolRemoteCandidate({ locationText })).toBe(true);
  });

  it("no pasa lo híbrido o presencial explícito", () => {
    expect(isPoolRemoteCandidate({ workplaceType: "Hybrid", locationText: "Ciudad A" })).toBe(
      false,
    );
    expect(isPoolRemoteCandidate({ workplaceType: "OnSite", locationText: "Remote" })).toBe(false);
    expect(isPoolRemoteCandidate({ workplaceType: "On-site" })).toBe(false);
    expect(isPoolRemoteCandidate({ workplaceType: "Presencial" })).toBe(false);
    expect(isPoolRemoteCandidate({ isRemote: false, locationText: "Ciudad A" })).toBe(false);
    expect(isPoolRemoteCandidate({ locationText: "Ciudad A (Hybrid)" })).toBe(false);
    expect(isPoolRemoteCandidate({ locationText: "Ciudad A, presencial" })).toBe(false);
    expect(isPoolRemoteCandidate({ locationText: "Hybrid" })).toBe(false);
    expect(isPoolRemoteCandidate({ locationText: "On-site" })).toBe(false);
  });

  it("no pasa una ubicación concreta sin señal de remoto", () => {
    expect(isPoolRemoteCandidate({ locationText: "Ciudad A, Pais B" })).toBe(false);
  });

  it("ante la duda (todo vacío) pasa", () => {
    expect(isPoolRemoteCandidate({})).toBe(true);
    expect(isPoolRemoteCandidate({ locationText: "  ", workplaceType: null, isRemote: null })).toBe(
      true,
    );
  });

  it("'Remote - US only' pasa: lo marca el prefiltro por usuario", () => {
    expect(isPoolRemoteCandidate({ locationText: "Remote - US only" })).toBe(true);
  });
});
