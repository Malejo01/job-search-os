import { describe, expect, it } from "vitest";
import { ESTADOS_TIPOS, poseDeEstado } from "../lib/estados-vacios";
import { MASCOTA_POSES } from "../lib/mascota";

describe("poseDeEstado", () => {
  it("todo tipo de vacío tiene una de las nueve poses reales", () => {
    for (const t of ESTADOS_TIPOS) expect(MASCOTA_POSES).toContain(poseDeEstado(t));
  });

  it("los vacíos genéricos van con `quieto`", () => {
    expect(poseDeEstado("lista-vacia")).toBe("quieto");
    expect(poseDeEstado("sin-resultados")).toBe("quieto");
    expect(poseDeEstado("sin-datos")).toBe("quieto");
  });

  it("Tracker y los errores «lo estamos revisando» van con `analizando`", () => {
    expect(poseDeEstado("postulaciones")).toBe("analizando");
    expect(poseDeEstado("error")).toBe("analizando");
  });

  it("la pantalla puede pedir otra pose y esa gana", () => {
    expect(poseDeEstado("lista-vacia", "trabajando")).toBe("trabajando");
    expect(poseDeEstado("error", "quieto")).toBe("quieto");
  });
});
