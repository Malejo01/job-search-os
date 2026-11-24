import { describe, expect, it } from "vitest";
import { ESTADOS_TIPOS, visualDeEstado } from "../lib/estados-vacios";
import { MASCOTA_DISPONIBLE, MASCOTA_IMAGENES, type MascotaImagen } from "../lib/mascota";

const sinMascota = Object.fromEntries(MASCOTA_IMAGENES.map((i) => [i, false])) as Record<
  MascotaImagen,
  boolean
>;
const conMascota = Object.fromEntries(MASCOTA_IMAGENES.map((i) => [i, true])) as Record<
  MascotaImagen,
  boolean
>;

describe("visualDeEstado", () => {
  it("sin mascota: la ilustración de la escena si el tipo la tiene", () => {
    expect(visualDeEstado("lista-vacia", sinMascota)).toEqual({
      kind: "ilustracion",
      escena: "vacio",
    });
    expect(visualDeEstado("postulaciones", sinMascota)).toEqual({
      kind: "ilustracion",
      escena: "postulaciones",
    });
    expect(visualDeEstado("error", sinMascota)).toEqual({ kind: "ilustracion", escena: "error" });
  });

  it("sin mascota ni escena: el monograma", () => {
    expect(visualDeEstado("sin-resultados", sinMascota)).toEqual({ kind: "monograma" });
    expect(visualDeEstado("sin-datos", sinMascota)).toEqual({ kind: "monograma" });
  });

  it("cuando la pose existe, la mascota tiene prioridad", () => {
    for (const t of ESTADOS_TIPOS) expect(visualDeEstado(t, conMascota).kind).toBe("mascota");
  });

  it("una pose que falta cae a la ilustración o al monograma, nunca a un hueco", () => {
    for (const t of ESTADOS_TIPOS) {
      expect(["ilustracion", "monograma"]).toContain(visualDeEstado(t, sinMascota).kind);
    }
  });

  it("por defecto lee las banderas reales de lib/mascota", () => {
    const real = visualDeEstado("lista-vacia");
    expect(real.kind).toBe(MASCOTA_DISPONIBLE.quieta ? "mascota" : "ilustracion");
  });
});
