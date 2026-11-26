import { describe, expect, it } from "vitest";
import { acceptsCountry } from "./countries-accepted";

describe("acceptsCountry (R30-05, «Aceptan {tu país}»)", () => {
  it("null o vacío: el aviso no dice países, no entra", () => {
    expect(acceptsCountry(null, "AR")).toBe(false);
    expect(acceptsCountry(undefined, "AR")).toBe(false);
    expect(acceptsCountry([], "AR")).toBe(false);
  });

  it("nombra el país: entra", () => {
    expect(acceptsCountry(["AR", "BR"], "AR")).toBe(true);
    expect(acceptsCountry(["ar"], "AR")).toBe(true);
  });

  it("nombra otros países: no entra", () => {
    expect(acceptsCountry(["US", "CA"], "AR")).toBe(false);
  });

  it("nombra la región del país: entra", () => {
    expect(acceptsCountry(["LATAM"], "AR")).toBe(true);
    expect(acceptsCountry(["Latin America"], "MX")).toBe(true);
    expect(acceptsCountry(["Americas"], "CL")).toBe(true);
  });

  it("una región que no incluye al país: no entra", () => {
    expect(acceptsCountry(["Europe"], "AR")).toBe(false);
    expect(acceptsCountry(["EMEA"], "AR")).toBe(false);
  });

  it("todo el mundo, explícito: entra", () => {
    expect(acceptsCountry(["*"], "AR")).toBe(true);
    expect(acceptsCountry(["Worldwide"], "AR")).toBe(true);
    expect(acceptsCountry(["Global"], "UY")).toBe(true);
  });

  it("texto que no se entiende: no entra (nunca se asume)", () => {
    expect(acceptsCountry(["Somewhere nice"], "AR")).toBe(false);
    expect(acceptsCountry(["US time zones"], "AR")).toBe(false);
  });

  it("sin país de la persona: el chip no tiene qué comparar, no entra", () => {
    expect(acceptsCountry(["AR"], null)).toBe(false);
    expect(acceptsCountry(["*"], "")).toBe(false);
  });

  it("UK es GB", () => {
    expect(acceptsCountry(["UK"], "GB")).toBe(true);
  });
});
