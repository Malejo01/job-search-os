import { describe, expect, it } from "vitest";
import {
  canonicalAcademyContent,
  contarTextosAprobados,
  decidirPublicacion,
  esHuellaValida,
  estadoDeTexto,
  type RevisionVigente,
} from "./publicacion";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const aprobada = (huella: string): RevisionVigente => ({ estado: "aprobada", huella });

describe("decidirPublicacion (R26-01 y R26-02)", () => {
  it("el archivo que dice aprobada se publica, con o sin revisión en la base", () => {
    expect(
      decidirPublicacion({ archivoEstado: "aprobada", huellaActual: H1, revision: null }),
    ).toEqual({ publicada: true, motivo: "archivo" });
    expect(
      decidirPublicacion({
        archivoEstado: "aprobada",
        huellaActual: H1,
        revision: { estado: "cambios", huella: H1 },
      }).publicada,
    ).toBe(true);
  });

  it("una aprobación en la base con la misma huella publica", () => {
    expect(
      decidirPublicacion({ archivoEstado: "borrador", huellaActual: H1, revision: aprobada(H1) }),
    ).toEqual({ publicada: true, motivo: "aprobada_en_base" });
  });

  it("si el contenido cambió (otra huella), la aprobación vieja no vale y vuelve a borrador", () => {
    expect(
      decidirPublicacion({ archivoEstado: "borrador", huellaActual: H2, revision: aprobada(H1) }),
    ).toEqual({ publicada: false, motivo: "huella_distinta" });
  });

  it("sin revisión, o con «cambios», no se publica", () => {
    expect(
      decidirPublicacion({ archivoEstado: "borrador", huellaActual: H1, revision: null }),
    ).toEqual({ publicada: false, motivo: "sin_revision" });
    expect(
      decidirPublicacion({
        archivoEstado: "borrador",
        huellaActual: H1,
        revision: { estado: "cambios", huella: H1 },
      }),
    ).toEqual({ publicada: false, motivo: "cambios_pedidos" });
  });

  it("falla cerrado: una huella ilegible o vacía nunca publica por la base", () => {
    for (const bad of ["", "abc", "A".repeat(64), "z".repeat(64)]) {
      expect(
        decidirPublicacion({
          archivoEstado: "borrador",
          huellaActual: bad,
          revision: aprobada(bad),
        }).publicada,
        bad,
      ).toBe(false);
    }
  });

  it("un estado de archivo raro cuenta como borrador", () => {
    expect(
      decidirPublicacion({
        archivoEstado: "publicada" as never,
        huellaActual: H1,
        revision: null,
      }).publicada,
    ).toBe(false);
  });
});

describe("esHuellaValida", () => {
  it("solo sha256 en hexadecimal minúscula", () => {
    expect(esHuellaValida(H1)).toBe(true);
    expect(esHuellaValida("a".repeat(63))).toBe(false);
    expect(esHuellaValida("A".repeat(64))).toBe(false);
    expect(esHuellaValida(null)).toBe(false);
    expect(esHuellaValida(undefined)).toBe(false);
  });
});

describe("canonicalAcademyContent", () => {
  const ficha = (estado: string | null, cuerpo = "Texto de la ficha.") =>
    `---\ntitulo: Una ficha\n${estado === null ? "" : `estado: ${estado}\n`}orden: 2\n---\n${cuerpo}\n`;

  it("aprobar (cambiar la línea estado) no cambia el contenido canónico", () => {
    expect(canonicalAcademyContent(ficha("borrador"))).toBe(
      canonicalAcademyContent(ficha("aprobada")),
    );
    expect(canonicalAcademyContent(ficha(null))).toBe(canonicalAcademyContent(ficha("aprobada")));
  });

  it("cambiar el cuerpo, el título o el orden sí lo cambia", () => {
    const base = canonicalAcademyContent(ficha("borrador"));
    expect(canonicalAcademyContent(ficha("borrador", "Otro texto."))).not.toBe(base);
    expect(canonicalAcademyContent(ficha("borrador").replace("Una ficha", "Otra"))).not.toBe(base);
    expect(canonicalAcademyContent(ficha("borrador").replace("orden: 2", "orden: 3"))).not.toBe(
      base,
    );
  });

  it("los fines de línea de Windows y los espacios al final no cambian la huella", () => {
    const lf = ficha("borrador");
    expect(canonicalAcademyContent(lf.replace(/\n/g, "\r\n"))).toBe(canonicalAcademyContent(lf));
    expect(canonicalAcademyContent(`${lf}\n\n`)).toBe(canonicalAcademyContent(lf));
  });

  it("solo ignora «estado» del frontmatter: una línea igual en el cuerpo cuenta", () => {
    const a = ficha("borrador", "Texto.\nestado: aprobada");
    const b = ficha("borrador", "Texto.");
    expect(canonicalAcademyContent(a)).not.toBe(canonicalAcademyContent(b));
  });
});

describe("estadoDeTexto (R26-02)", () => {
  it("sin revisión, sin revisar", () => {
    expect(estadoDeTexto(H1, null)).toBe("sin_revisar");
  });

  it("aprobado vale solo con la huella del texto de hoy", () => {
    expect(estadoDeTexto(H1, { estado: "aprobada", huella: H1 })).toBe("aprobado");
    expect(estadoDeTexto(H2, { estado: "aprobada", huella: H1 })).toBe("cambio_el_codigo");
  });

  it("una propuesta no aprueba nada; si el texto cambió desde entonces, se marca", () => {
    expect(estadoDeTexto(H1, { estado: "propuesta", huella: H1 })).toBe("propuesta");
    expect(estadoDeTexto(H2, { estado: "propuesta", huella: H1 })).toBe("propuesta_vieja");
  });

  it("falla cerrado: una huella ilegible nunca queda aprobada", () => {
    expect(estadoDeTexto("", { estado: "aprobada", huella: "" })).toBe("sin_revisar");
    expect(estadoDeTexto("x", { estado: "aprobada", huella: "x" })).toBe("sin_revisar");
  });
});

describe("contarTextosAprobados (R26-02)", () => {
  const textos = [
    { clave: "A.uno", huella: H1 },
    { clave: "A.dos", huella: H2 },
    { clave: "B.uno", huella: H1 },
  ];

  it("cuenta solo los aprobados con la huella de hoy", () => {
    const revisiones = new Map([
      ["A.uno", { estado: "aprobada" as const, huella: H1 }],
      ["A.dos", { estado: "aprobada" as const, huella: H1 }], // el texto cambió: no vale
      ["B.uno", { estado: "propuesta" as const, huella: H1 }], // propuesta: no aprueba
      ["C.fuera", { estado: "aprobada" as const, huella: H1 }], // ya no existe: no cuenta
    ]);
    expect(contarTextosAprobados(textos, revisiones)).toEqual({ total: 3, aprobados: 1 });
  });

  it("sin revisiones, cero", () => {
    expect(contarTextosAprobados(textos, new Map())).toEqual({ total: 3, aprobados: 0 });
    expect(contarTextosAprobados([], new Map())).toEqual({ total: 0, aprobados: 0 });
  });
});
