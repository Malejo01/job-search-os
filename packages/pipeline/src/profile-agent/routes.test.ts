import { describe, expect, it } from "vitest";
import {
  PROFILE_AGENT_API,
  PROFILE_AGENT_STORAGE_KEYS,
  profileAgentPath,
  type ProfileAgentBase,
  type ProfileAgentPageStage,
} from "./routes";

describe("rutas del agente de perfil", () => {
  it("las dos bases y las cuatro etapas", () => {
    const stages: ProfileAgentPageStage[] = ["read", "gaps", "guide", "done"];
    const expected: Record<ProfileAgentBase, string[]> = {
      app: ["/cv/perfil", "/cv/perfil/huecos", "/cv/perfil/guia", "/cv/perfil/listo"],
      onboarding: [
        "/onboarding/cv",
        "/onboarding/cv/huecos",
        "/onboarding/cv/guia",
        "/onboarding/cv/listo",
      ],
    };
    for (const base of ["app", "onboarding"] as const) {
      expect(stages.map((s) => profileAgentPath(base, s))).toEqual(expected[base]);
    }
  });
  it("una API por etapa bajo el mismo prefijo", () => {
    const urls = Object.values(PROFILE_AGENT_API);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith("/api/cv-perfil/")).toBe(true);
  });
  it("las claves del navegador son de sessionStorage y no se pisan con otras", () => {
    const keys = Object.values(PROFILE_AGENT_STORAGE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.startsWith("jso:pa:")).toBe(true);
  });
});
