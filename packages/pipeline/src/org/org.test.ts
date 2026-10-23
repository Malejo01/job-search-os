import { describe, expect, it } from "vitest";
import { INVITE_CSV_MAX_ROWS, parseInviteCsv } from "./invite-csv";
import { checkOrgLogo, orgAccentColor } from "./logo";
import { maskedCount, maskedPercent, peopleBucket, publishableCohorts } from "./metrics";
import { checkSeats, seatsMessage } from "./seats";

const BOM = String.fromCharCode(0xfeff);

describe("parseInviteCsv (C-16 B2B-2)", () => {
  it("acepta encabezado, BOM de Excel, CRLF, «;» y comillas", () => {
    const csv = `${BOM}email;cohorte\r\n"Ana@Ejemplo.test";2026-1\r\nbeto@ejemplo.test\r\n\r\n`;
    const result = parseInviteCsv(csv);
    expect(result).toEqual({
      ok: true,
      rows: [
        { line: 2, email: "ana@ejemplo.test", cohort: "2026-1" },
        { line: 3, email: "beto@ejemplo.test", cohort: null },
      ],
    });
  });

  it("sin encabezado también sirve", () => {
    const result = parseInviteCsv("uno@ejemplo.test\ndos@ejemplo.test");
    expect(result.ok && result.rows.map((r) => r.email)).toEqual([
      "uno@ejemplo.test",
      "dos@ejemplo.test",
    ]);
  });

  it("falla cerrado y junta todos los errores con su línea", () => {
    const csv = "email\nuno@ejemplo.test\nno-es-email\nUNO@ejemplo.test\na@b.test,x,y";
    expect(parseInviteCsv(csv)).toEqual({
      ok: false,
      errors: [
        { line: 3, reason: "email" },
        { line: 4, reason: "duplicado" },
        { line: 5, reason: "columnas" },
      ],
    });
  });

  it("un encabezado desconocido, un archivo vacío o con demasiadas filas no pasan", () => {
    expect(parseInviteCsv("correo,grupo\na@b.test")).toMatchObject({ ok: false });
    expect(parseInviteCsv("\n\n")).toEqual({ ok: false, errors: [{ line: 0, reason: "vacio" }] });
    const lines = Array.from({ length: INVITE_CSV_MAX_ROWS + 1 }, (_, i) => `p${i}@ejemplo.test`);
    const many = parseInviteCsv(lines.join("\n"));
    expect(many).toEqual({ ok: false, errors: [{ line: 0, reason: "muchas_filas" }] });
  });
});

describe("enmascarado de las métricas de una institución (C-16 §3)", () => {
  it("los rangos de personas en los bordes", () => {
    const cases = [4, 5, 9, 10, 19, 20].map((n) => [n, peopleBucket(n)]);
    expect(cases).toEqual([
      [4, "<5"],
      [5, "5-9"],
      [9, "5-9"],
      [10, "10-19"],
      [19, "10-19"],
      [20, "20+"],
    ]);
  });

  it("un conteo se suprime por las personas detrás, no por las filas", () => {
    // 7 entrevistas de 2 personas: no se informa
    expect(maskedCount(7, 2)).toBeNull();
    expect(maskedCount(12, 5)).toBe(10);
    expect(maskedCount(23, 20)).toBe(23);
  });

  it("con menos de 20 personas, un conteo de 0 no se distingue de uno chico", () => {
    expect([0, 2, 3].map((v) => maskedCount(v, 8))).toEqual([5, 5, 5]);
  });

  it("los porcentajes se redondean a 5 con base chica", () => {
    expect(maskedPercent(1, 4)).toBeNull();
    expect(maskedPercent(4, 7)).toBe(55);
    expect(maskedPercent(13, 40)).toBe(33);
  });

  it("con base chica, el 0 % y el 100 % quedan acotados a 5 y 95", () => {
    expect([maskedPercent(0, 6), maskedPercent(6, 6)]).toEqual([5, 95]);
    expect([maskedPercent(0, 20), maskedPercent(20, 20)]).toEqual([0, 100]);
  });

  it("regla complementaria: con dos cohortes, si una no llega a 5 caen las dos", () => {
    const both = new Map([
      ["c1", 6],
      ["c2", 5],
    ]);
    expect([...publishableCohorts(both)].sort()).toEqual(["c1", "c2"]);
    const small = new Map([
      ["c1", 6],
      ["c2", 4],
    ]);
    expect(publishableCohorts(small).size).toBe(0);
  });

  it("con tres cohortes, si la que se oculta se deduciría por diferencia, se oculta todo", () => {
    const three = new Map([
      ["c1", 6],
      ["c2", 6],
      ["c3", 3],
    ]);
    expect(publishableCohorts(three).size).toBe(0);
    const four = new Map([
      ["c1", 6],
      ["c2", 6],
      ["c3", 3],
      ["c4", 3],
    ]);
    expect([...publishableCohorts(four)].sort()).toEqual(["c1", "c2"]);
  });

  it("dos cohortes ocultas que juntas llegan a 5 dejan publicar la grande", () => {
    const one = new Map([
      ["c1", 10],
      ["c2", 3],
      ["c3", 3],
    ]);
    expect([...publishableCohorts(one)]).toEqual(["c1"]);
  });
});

describe("logo y color de una institución (C-16 §4)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  it("acepta PNG y JPEG por sus primeros bytes y rechaza SVG", () => {
    expect(checkOrgLogo(png)).toEqual({ ok: true, contentType: "image/png" });
    expect(checkOrgLogo(jpeg)).toEqual({ ok: true, contentType: "image/jpeg" });
    expect(checkOrgLogo(svg)).toEqual({ ok: false, reason: "formato" });
  });

  it("un archivo renombrado, vacío o de más de 100 KB no pasa", () => {
    const renamed = new TextEncoder().encode("no soy una imagen.png");
    expect(checkOrgLogo(renamed)).toEqual({ ok: false, reason: "formato" });
    expect(checkOrgLogo(new Uint8Array())).toEqual({ ok: false, reason: "vacio" });
    const big = new Uint8Array(100 * 1024 + 1);
    big.set(png);
    expect(checkOrgLogo(big)).toEqual({ ok: false, reason: "muy_grande" });
  });

  it("el color de acento solo acepta #rrggbb", () => {
    expect(orgAccentColor(" #1A2B3C ")).toBe("#1a2b3c");
    expect(orgAccentColor("red")).toBeNull();
    expect(orgAccentColor("#fff")).toBeNull();
    expect(orgAccentColor(null)).toBeNull();
  });
});

describe("cupos de una institución (C-16 §2.2)", () => {
  it("las invitaciones pendientes reservan cupo", () => {
    const check = checkSeats({ seats: 10, active: 5, pendingNotExpired: 2, requested: 8 });
    expect(check).toEqual({ ok: false, left: 3 });
    expect(seatsMessage(check, 8)).toBe("Quedan 3 cupos y la planilla trae 8.");
  });

  it("con lugar, pasa y no hay mensaje", () => {
    const check = checkSeats({ seats: 10, active: 5, pendingNotExpired: 2, requested: 3 });
    expect(check).toEqual({ ok: true, left: 3 });
    expect(seatsMessage(check, 3)).toBeNull();
  });
});
