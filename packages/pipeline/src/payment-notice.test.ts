import { describe, expect, it } from "vitest";
import {
  decidePaymentNotice,
  MAX_OPEN_PAYMENT_NOTICES,
  OPERATION_NUMBER_MAX_LENGTH,
  parseOperationNumber,
  PAYMENT_NOTICE_STATUSES,
} from "./payment-notice";

describe("parseOperationNumber", () => {
  it("vacío, espacios o ausente valen: no hay número", () => {
    expect(parseOperationNumber("")).toEqual({ ok: true, value: null });
    expect(parseOperationNumber("   ")).toEqual({ ok: true, value: null });
    expect(parseOperationNumber(null)).toEqual({ ok: true, value: null });
    expect(parseOperationNumber(undefined)).toEqual({ ok: true, value: null });
  });

  it("acepta solo dígitos y recorta los bordes", () => {
    expect(parseOperationNumber("123456789")).toEqual({ ok: true, value: "123456789" });
    expect(parseOperationNumber("  987654  ")).toEqual({ ok: true, value: "987654" });
  });

  it("rechaza letras, signos, espacios internos y formatos con separadores", () => {
    for (const bad of ["12a4", "12 34", "12-34", "#1234", "1.234", "1e5", "-5", "١٢٣"]) {
      expect(parseOperationNumber(bad)).toEqual({ ok: false, error: "invalido" });
    }
  });

  it("rechaza lo que no es texto", () => {
    expect(parseOperationNumber(123)).toEqual({ ok: false, error: "invalido" });
    expect(parseOperationNumber({})).toEqual({ ok: false, error: "invalido" });
  });

  it("acota el largo", () => {
    const max = "9".repeat(OPERATION_NUMBER_MAX_LENGTH);
    expect(parseOperationNumber(max)).toEqual({ ok: true, value: max });
    expect(parseOperationNumber(`${max}9`)).toEqual({ ok: false, error: "invalido" });
  });
});

describe("decidePaymentNotice", () => {
  it("el tope es 3 avisos abiertos", () => {
    expect(MAX_OPEN_PAYMENT_NOTICES).toBe(3);
  });

  it("crea mientras haya lugar", () => {
    expect(decidePaymentNotice(0)).toEqual({ ok: true, value: "crear" });
    expect(decidePaymentNotice(2)).toEqual({ ok: true, value: "crear" });
  });

  it("con 3 abiertos no crea el cuarto", () => {
    expect(decidePaymentNotice(3)).toEqual({ ok: false, error: "tope" });
    expect(decidePaymentNotice(10)).toEqual({ ok: false, error: "tope" });
  });

  it("falla cerrado ante un conteo que no es válido", () => {
    expect(decidePaymentNotice(-1)).toEqual({ ok: false, error: "tope" });
    expect(decidePaymentNotice(Number.NaN)).toEqual({ ok: false, error: "tope" });
    expect(decidePaymentNotice(1.5)).toEqual({ ok: false, error: "tope" });
  });
});

describe("estados", () => {
  it("son los tres acordados", () => {
    expect([...PAYMENT_NOTICE_STATUSES]).toEqual(["pendiente", "activado", "rechazado"]);
  });
});
